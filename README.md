# desosp-testes

Automação E2E (Playwright) do fluxo SAE → Auditoria Clínica → Transição de Cuidado, com um painel local para rodar cada fluxo por botão.

## Pré-requisitos

- Node.js 18+
- VPN da Unimed POA conectada (SAE HML01 e ambientes TEST/DEV só respondem nela)
- Usuário no SAE HML01 e conta Microsoft com acesso à Auditoria Clínica e ao Transição de Cuidado

## Instalação

```bash
npm install
npx playwright install chromium
```

## Uso

```bash
npm run painel
```

Abra http://localhost:4600 e siga o botão de ajuda (**?**), ao lado da engrenagem:

1. Logue na VPN da Unimed POA.
2. Clique na engrenagem (Configurações) e em **Renovar login** e faça login no SAE (e no Microsoft) quando requisitado.
3. Escolha o ambiente (HML ou DEV), comece por **Criar internação** e rode os fluxos pelos botões. Ao final, **Finalizar internação**.

O SAE é sempre o HML01; o seletor de ambiente troca só a Auditoria Clínica e o Transição de Cuidado (`unimedpoa-test` ↔ `unimedpoa-dev`).

## Temas

Na engrenagem (Configurações) → **Tema**: **Auditoria** (padrão, visual da Cockpit de Auditoria Clínica) ou **Dark**. A escolha fica salva no navegador.

- As fontes Unimed do tema Auditoria não ficam no repositório: ao iniciar, o painel baixa da própria Cockpit (arquivos públicos) para `.estado/fontes/`. Sem acesso, usa a fonte do sistema.
- Os ícones do tema Auditoria são do Font Awesome 7 Free (CDN); sem internet, o painel volta para os ícones próprios.

## Segurança

- Nenhuma senha passa pelo código: o login é sempre manual.
- `.auth/`, `.estado/`, relatórios e traces ficam só na máquina (estão no `.gitignore`), pois guardam sessão e dados de tela.
- Dados digitados pela automação são fictícios e levam o prefixo `[Exemplo]`.
