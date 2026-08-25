#!/usr/bin/env python3
"""
Auditoria da rede SME — varre os repositórios da organização procurando o que
não deveria estar publicado, e abre uma issue no repositório onde encontrar.

O que procura, em ordem de gravidade:

  1. Arquivo de dado rastreado (.sql, .csv, .xlsx, .dump…) — e, dentro dele,
     padrão de e-mail ou CPF. Foi assim que ~3,5 mil e-mails de participantes
     ficaram públicos por meses sem ninguém notar.
  2. Credencial: chave `service_role` do Supabase, chave privada, token.
     A chave `anon` NÃO conta — ela é pública por natureza e vai para o
     navegador de qualquer visitante. O script decodifica o JWT e olha o papel
     antes de acusar, senão acusaria toda a rede todo dia e ninguém leria mais.
  3. Ausência de CLAUDE.md, ou .gitignore sem as regras de dado.

⚠️ NUNCA imprime o conteúdo encontrado — só caminho e contagem. Uma auditoria
que cola a amostra numa issue pública republica o vazamento que veio denunciar.

⚠️ Olha o QUE ESTÁ RASTREADO NO HEAD, não o histórico. Arquivo apagado num
commit anterior continua público e este script não o vê. Para isso a
verificação é outra (`git log --diff-filter=A`), cara demais para rodar semanal
sobre a organização inteira.
"""

import base64
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile
import urllib.error
import urllib.request

API = "https://api.github.com"
ORG = os.environ.get("ORG", "smedigital-desenv")
TOKEN = os.environ.get("AUDITORIA_TOKEN") or os.environ.get("GITHUB_TOKEN")
DRY_RUN = os.environ.get("DRY_RUN", "").lower() in ("1", "true", "yes")

# Sem o token da organização sobra o GITHUB_TOKEN do próprio workflow, que
# alcança os repositórios PÚBLICOS para ler, mas só abre issue AQUI. Nesse
# modo a varredura continua inteira e o relatório vira uma issue só, neste
# repositório.
#
# ⚠️ Antes, a falta do secret abortava o job na primeira linha. O resultado é
# que a auditoria NUNCA rodou: as duas execuções agendadas de 2026-08 morreram
# em "Falta o secret", e foi por isso que 17 scripts com 3.152 e-mails ficaram
# meses publicados sem ninguém ser avisado. Alarme que não toca é pior que
# alarme nenhum, porque dá a sensação de que alguém está olhando.
MODO_LIMITADO = not os.environ.get("AUDITORIA_TOKEN")
PROPRIO_REPO = os.environ.get("GITHUB_REPOSITORY") or f"{ORG}/smedigital-desenv.github.io"

TITULO_ISSUE = "🔒 Auditoria da rede — pendências neste repositório"
LABEL = "auditoria-rede"

# Extensões que carregam dado real quase sempre sem quem commitou perceber.
# Mesma lista de `EXT_PROIBIDA`, na guarda anti-vazamento. As duas precisam
# concordar: a guarda impede o próximo arquivo, esta auditoria acha os que já
# estão publicados. Se divergirem, existe formato que entra e nunca é achado.
EXT_DADO = re.compile(
    r"\.(sql|csv|tsv|dump|sqlite|sqlite3|parquet|xls|xlsx|xlsm|mdb|accdb)$", re.I
)
EXT_CHAVE = re.compile(r"\.(pem|key|p12|pfx)$", re.I)

# ⚠️ O `%` fica FORA da parte local de propósito: com ele, o coringa do SQL
# (`email like '%@educacao.pmrp.sp.gov.br'`) contava como endereço de gente, e
# uma checagem de domínio virava "dado pessoal publicado". Mesma regra da
# guarda anti-vazamento.
RE_EMAIL = re.compile(rb"[A-Za-z0-9._+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}")
RE_CPF = re.compile(rb"\b\d{3}\.\d{3}\.\d{3}-\d{2}\b")
RE_JWT = re.compile(rb"eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{10,}")
RE_PRIV = re.compile(rb"-----BEGIN [A-Z ]*PRIVATE KEY-----")

# Arquivos grandes demais para inspecionar linha a linha; a extensão já basta.
LIMITE_LEITURA = 8 * 1024 * 1024

# Fila revisada. Um `.auditoria-ignore` na raiz do repositório tira da CONTA os
# caminhos que uma pessoa já olhou e considerou legítimos — uma linha por
# caminho, com o motivo depois de `#`. O motivo é obrigatório: sem ele a linha
# não vale.
#
# ⚠️ Isto NÃO some com o achado: ele continua aparecendo na issue, numa seção
# própria, com o motivo ao lado. O que muda é que deixa de contar como
# pendência. Detector que continua gritando depois de revisado é detector que
# as pessoas desligam — e aí o próximo achado de verdade passa junto.
ARQ_REVISADOS = ".guarda-permitidos"


def ler_revisados(raiz):
    """Lê `.guarda-permitidos` — o MESMO arquivo que a guarda e o workflow leem.

    Dois formatos, os dois válidos, porque os dois já existiam na rede:

        caminho.xls # motivo numa linha só
        # motivo em bloco, acima
        caminho.xls

    Linha terminada em `/` cobre a pasta inteira.
    """
    caminho = os.path.join(raiz, ARQ_REVISADOS)
    if not os.path.exists(caminho):
        return {}
    revisados, bloco = {}, []
    with open(caminho, encoding="utf-8", errors="replace") as f:
        for linha in f:
            linha = linha.strip()
            if not linha:
                bloco = []
                continue
            if linha.startswith("#"):
                bloco.append(linha.lstrip("#").strip())
                continue
            if "#" in linha:
                alvo, motivo = linha.split("#", 1)
                alvo, motivo = alvo.strip(), motivo.strip()
            else:
                # O bloco de comentário NÃO é consumido pelo primeiro caminho:
                # uma justificativa costuma cobrir um grupo de arquivos, e só a
                # linha em branco fecha o grupo. Sem isso, o segundo caminho do
                # grupo aparecia como "sem justificativa escrita".
                alvo, motivo = linha, " ".join(bloco).strip()
            if alvo:
                revisados[alvo] = motivo or "sem justificativa escrita"
    return revisados


def esta_revisado(caminho, revisados):
    if caminho in revisados:
        return revisados[caminho]
    for alvo, motivo in revisados.items():
        if alvo.endswith("/") and caminho.startswith(alvo):
            return motivo
    return None


# ─────────────────────────────── GitHub API ────────────────────────────────
def api(caminho, metodo="GET", corpo=None):
    url = caminho if caminho.startswith("http") else API + caminho
    dados = json.dumps(corpo).encode() if corpo is not None else None
    req = urllib.request.Request(url, data=dados, method=metodo)
    req.add_header("Authorization", f"Bearer {TOKEN}")
    req.add_header("Accept", "application/vnd.github+json")
    req.add_header("X-GitHub-Api-Version", "2022-11-28")
    if dados:
        req.add_header("Content-Type", "application/json")
    with urllib.request.urlopen(req) as r:
        texto = r.read().decode()
        link = r.headers.get("Link", "")
    return (json.loads(texto) if texto else None), link


def paginar(caminho):
    itens, prox = [], caminho
    while prox:
        pagina, link = api(prox)
        itens.extend(pagina or [])
        prox = None
        for parte in link.split(","):
            if 'rel="next"' in parte:
                prox = parte.split(";")[0].strip().strip("<>")
    return itens


# ────────────────────────────────── Exame ──────────────────────────────────
def papel_do_jwt(token_bytes):
    """Devolve o papel declarado no JWT, ou None se não der para ler.

    A chave `anon` e a `service_role` são ambas JWT e visualmente idênticas.
    A diferença mora no payload, e é a diferença entre 'pode versionar' e
    'incidente'."""
    try:
        payload = token_bytes.split(b".")[1]
        payload += b"=" * (-len(payload) % 4)
        return json.loads(base64.urlsafe_b64decode(payload)).get("role")
    except Exception:
        return None


def examinar_arquivo(raiz, caminho):
    """Devolve lista de achados para um arquivo. Só metadado, nunca conteúdo."""
    achados = []
    completo = os.path.join(raiz, caminho)
    try:
        tamanho = os.path.getsize(completo)
    except OSError:
        return achados

    e_dado = bool(EXT_DADO.search(caminho))
    if EXT_CHAVE.search(caminho):
        achados.append(("credencial", caminho, "arquivo de chave rastreado"))

    if tamanho > LIMITE_LEITURA:
        if e_dado:
            achados.append(("dado", caminho, f"{tamanho // 1024} kB, não inspecionado"))
        return achados

    try:
        with open(completo, "rb") as f:
            conteudo = f.read()
    except OSError:
        return achados

    if RE_PRIV.search(conteudo):
        achados.append(("credencial", caminho, "chave privada embutida"))

    for token in set(RE_JWT.findall(conteudo)):
        papel = papel_do_jwt(token)
        if papel and papel != "anon":
            achados.append(("credencial", caminho, f"JWT com papel `{papel}`"))

    if e_dado:
        emails = len(set(RE_EMAIL.findall(conteudo)))
        cpfs = len(set(RE_CPF.findall(conteudo)))
        if emails or cpfs:
            partes = []
            if emails:
                partes.append(f"{emails} e-mail distinto" if emails == 1
                              else f"{emails} e-mails distintos")
            if cpfs:
                partes.append("1 CPF" if cpfs == 1 else f"{cpfs} CPFs")
            achados.append(("pessoal", caminho, ", ".join(partes)))
        else:
            achados.append(("dado", caminho, "sem padrão pessoal detectado"))

    return achados


def examinar_repo(nome_completo, destino):
    url = f"https://x-access-token:{TOKEN}@github.com/{nome_completo}"
    r = subprocess.run(
        ["git", "clone", "--depth", "1", "--quiet", url, destino],
        capture_output=True, text=True,
    )
    if r.returncode != 0:
        return None, f"não foi possível clonar ({r.stderr.strip()[:120]})"

    rastreados = subprocess.run(
        ["git", "-C", destino, "ls-files"], capture_output=True, text=True
    ).stdout.splitlines()
    if not rastreados:
        return {"pessoal": [], "dado": [], "credencial": [], "estrutura": []}, None

    achados = {"pessoal": [], "dado": [], "credencial": [], "estrutura": [], "revisado": []}
    revisados = ler_revisados(destino)
    for caminho in rastreados:
        if EXT_DADO.search(caminho) or EXT_CHAVE.search(caminho) or caminho.endswith(
            (".js", ".ts", ".html", ".json", ".yml", ".yaml", ".env", ".md")
        ):
            for tipo, arq, detalhe in examinar_arquivo(destino, caminho):
                motivo = esta_revisado(arq, revisados)
                if motivo:
                    achados["revisado"].append((arq, f"{detalhe} — {motivo}"))
                else:
                    achados[tipo].append((arq, detalhe))

    for esperado, oquee in (
        (".claude/hooks/verificar-vazamento.sh", "a guarda anti-vazamento não está versionada aqui"),
        (".github/workflows/guarda-dados.yml", "sem a porta que roda no GitHub: quem clonar sem os hooks passa direto"),
        (".githooks/pre-commit", "sem a porta do git: quem commita fora do Claude Code não encontra guarda"),
    ):
        if esperado not in rastreados:
            achados["estrutura"].append((esperado, oquee))

    if "CLAUDE.md" not in rastreados:
        achados["estrutura"].append(
            ("CLAUDE.md", "ausente — as sessões do Claude Code entram sem as regras da rede")
        )
    gitignore = os.path.join(destino, ".gitignore")
    if not os.path.exists(gitignore):
        achados["estrutura"].append((".gitignore", "ausente"))
    else:
        with open(gitignore, encoding="utf-8", errors="replace") as f:
            texto = f.read()
        faltando = [e for e in ("*.sql", "*.csv", "*.xlsx") if e not in texto]
        if faltando:
            achados["estrutura"].append(
                (".gitignore", "sem as regras: " + ", ".join(f"`{e}`" for e in faltando))
            )

    return achados, None


# ─────────────────────────────── Relatório ─────────────────────────────────
def montar_corpo(achados):
    linhas = [
        "> Aberta automaticamente pela auditoria semanal da rede "
        "(`.github/workflows/auditoria-rede.yml`, no repositório do portal).",
        "> A issue é **atualizada**, não duplicada, e fecha sozinha quando não sobra pendência.",
        "",
        "⚠️ **Este repositório é público.** Nada abaixo cita conteúdo — só caminho e contagem.",
        "",
    ]

    if achados["pessoal"]:
        linhas += [
            "## 🔴 Dado pessoal publicado",
            "",
            "Estes arquivos estão rastreados e contêm padrão de dado pessoal. "
            "Estão públicos **agora**.",
            "",
            "| Arquivo | O que foi detectado |",
            "|---|---|",
        ]
        linhas += [f"| `{a}` | {d} |" for a, d in achados["pessoal"]]
        linhas += [
            "",
            "⚠️ **`git rm --cached` não resolve.** Tira do próximo commit e deixa tudo "
            "nos commits anteriores. Resolver exige reescrita de histórico "
            "(`git filter-repo`), força-push em todas as branches e chamado no suporte "
            "do GitHub para purgar as referências que sobrevivem em `refs/pull/*`.",
            "",
        ]

    if achados["credencial"]:
        linhas += [
            "## 🔴 Possível credencial",
            "",
            "A chave `anon` do Supabase é pública por natureza e **não** aparece aqui — "
            "o papel do JWT é lido antes de acusar. O que está listado é outra coisa.",
            "",
            "| Arquivo | O quê |",
            "|---|---|",
        ]
        linhas += [f"| `{a}` | {d} |" for a, d in achados["credencial"]]
        linhas += ["", "**Rode a rotação da credencial antes de mexer no histórico.** "
                       "Enquanto ela for válida, apagar do Git não adianta nada.", ""]

    if achados["dado"]:
        linhas += [
            "## 🟠 Arquivo de dado rastreado",
            "",
            "Nenhum padrão pessoal detectado, mas o formato é o que costuma carregar "
            "dado real junto. Confira antes de considerar falso positivo.",
            "",
            "| Arquivo | |",
            "|---|---|",
        ]
        linhas += [f"| `{a}` | {d} |" for a, d in achados["dado"]]
        linhas += [""]

    if achados["revisado"]:
        linhas += [
            "## ⚪ Já revisado — não conta como pendência",
            "",
            f"Listado em `{ARQ_REVISADOS}`. Continua aparecendo aqui de propósito: "
            "revisado não é invisível. Se algum destes deixou de ser legítimo, tire a "
            "linha de lá.",
            "",
            "| Arquivo | Detectado — motivo de estar liberado |",
            "|---|---|",
        ]
        linhas += [f"| `{a}` | {d} |" for a, d in achados["revisado"]]
        linhas += [""]

    if achados["estrutura"]:
        linhas += [
            "## 🟡 Estrutura",
            "",
            "| Item | |",
            "|---|---|",
        ]
        linhas += [f"| `{a}` | {d} |" for a, d in achados["estrutura"]]
        linhas += [
            "",
            "Para corrigir, copie do "
            "[`template-sistema-sme`](https://github.com/smedigital-desenv/template-sistema-sme).",
            "",
        ]

    return "\n".join(linhas)


def sincronizar_issue(repo, corpo, tem_pendencia):
    abertas = paginar(f"/repos/{repo}/issues?state=open&labels={LABEL}&per_page=50")
    existente = next((i for i in abertas if i.get("title") == TITULO_ISSUE), None)

    if not tem_pendencia:
        if existente:
            if DRY_RUN:
                print(f"    [dry-run] fecharia a issue #{existente['number']}")
            else:
                api(f"/repos/{repo}/issues/{existente['number']}", "PATCH",
                    {"state": "closed", "state_reason": "completed"})
                api(f"/repos/{repo}/issues/{existente['number']}/comments", "POST",
                    {"body": "Nenhuma pendência na varredura desta semana. Fechando."})
                print(f"    issue #{existente['number']} fechada — repositório limpo")
        return

    if DRY_RUN:
        print(f"    [dry-run] abriria/atualizaria issue em {repo}")
        return

    if existente:
        api(f"/repos/{repo}/issues/{existente['number']}", "PATCH", {"body": corpo})
        print(f"    issue #{existente['number']} atualizada")
    else:
        try:
            api(f"/repos/{repo}/labels", "POST",
                {"name": LABEL, "color": "B60205",
                 "description": "Aberta pela auditoria semanal da rede"})
        except urllib.error.HTTPError:
            pass  # já existe
        nova, _ = api(f"/repos/{repo}/issues", "POST",
                      {"title": TITULO_ISSUE, "body": corpo, "labels": [LABEL]})
        print(f"    issue #{nova['number']} aberta")


# ──────────────────────────────────  main  ─────────────────────────────────
def main():
    if not TOKEN:
        sys.exit("Sem token nenhum: nem AUDITORIA_TOKEN nem GITHUB_TOKEN.")
    if MODO_LIMITADO:
        print("AVISO: sem AUDITORIA_TOKEN. A varredura roda igual, nos repositórios")
        print("       públicos, mas o relatório sai numa issue única em")
        print(f"       {PROPRIO_REPO}, em vez de uma por repositório.")
        print("       Para voltar ao normal, crie o secret (cabeçalho do workflow).\n")

    repos = paginar(f"/orgs/{ORG}/repos?per_page=100&type=all")
    repos = [r for r in repos if not r.get("archived")]
    print(f"{len(repos)} repositórios a examinar em {ORG}\n")

    resumo, falhas, consolidado = [], [], []
    for r in sorted(repos, key=lambda x: x["full_name"]):
        nome = r["full_name"]
        print(f"→ {nome}")
        destino = tempfile.mkdtemp(prefix="aud-")
        try:
            achados, erro = examinar_repo(nome, destino)
            if erro:
                print(f"    {erro}")
                falhas.append((nome, erro))
                continue
            total = sum(len(v) for k, v in achados.items() if k != "revisado")
            grave = len(achados["pessoal"]) + len(achados["credencial"])
            print(f"    {total} pendência(s), {grave} grave(s)")
            if MODO_LIMITADO:
                if total:
                    consolidado.append((nome, grave, montar_corpo(achados)))
            else:
                sincronizar_issue(nome, montar_corpo(achados), total > 0)
            if total:
                resumo.append((nome, total, grave))
        finally:
            shutil.rmtree(destino, ignore_errors=True)

    if MODO_LIMITADO:
        corpo = ["> Varredura da rede sem o secret `AUDITORIA_TOKEN`: o relatório de",
                 "> **todos** os repositórios sai aqui, numa issue só, porque o token do",
                 "> próprio workflow não abre issue nos outros.",
                 ""]
        for nome, grave, texto in sorted(consolidado, key=lambda x: -x[1]):
            corpo += [f"# {'🔴' if grave else '🟡'} `{nome}`", "", texto, "", "---", ""]
        sincronizar_issue(PROPRIO_REPO, "\n".join(corpo), bool(consolidado))

    print("\n" + "=" * 60)
    if not resumo and not falhas:
        print("Nenhuma pendência na rede.")
    for nome, total, grave in sorted(resumo, key=lambda x: -x[2]):
        marca = "🔴" if grave else "🟡"
        print(f"{marca} {nome}: {total} pendência(s), {grave} grave(s)")
    for nome, erro in falhas:
        print(f"⚠️  {nome}: {erro}")

    # Falha o job quando há achado grave, para o e-mail do GitHub chegar mesmo
    # a quem não acompanha issue.
    if any(g for _, _, g in resumo):
        sys.exit("Há dado pessoal ou credencial publicada. Veja as issues abertas.")


if __name__ == "__main__":
    main()
