# desosp-testes

Automação E2E (Playwright) do fluxo SAE → Auditoria Clínica → Transição de Cuidado, com um painel local para rodar cada fluxo por botão.

## Pré-requisitos

- Node.js 18+
- VPN da Unimed POA conectada (SAE HML01 e ambientes TEST/DEV só respondem nela)
- Usuário no SAE (HML01 e, para PRD, o de produção) e conta Microsoft com acesso à Auditoria Clínica e ao Transição de Cuidado

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
3. Escolha o ambiente (DEV, HML ou PRD), comece por **Criar internação** e rode os fluxos pelos botões. Ao final, **Finalizar internação**.

| Ambiente | Auditoria e Transição | SAE |
|---|---|---|
| DEV | `unimedpoa-dev.outsystems.app` | `sae01-hml` (HML01) |
| HML | `unimedpoa-test.outsystems.app` | `sae01-hml` (HML01) |
| PRD | `app.unimedpoa.com.br` | `sae.unimedpoa.com.br` |

Cada ambiente tem a sua sessão de login (`.auth/<ambiente>.json`). DEV e HML compartilham o login do SAE; PRD nunca.

A internação em uso (a trava entre os fluxos) é uma por SAE: DEV e HML dividem a mesma (`.estado/internacao-atual.json`), porque usam o mesmo SAE e o passo 0 da criação finaliza as abertas da paciente de teste nele; PRD tem a sua (`.estado/internacao-prd.json`). Dá para ter uma internação em uso em PRD e outra em DEV/HML ao mesmo tempo.

### Produção (PRD)

Em PRD os fluxos gravam **dados reais**: internação no SAE de produção, desosp e avaliações para as equipes reais do Transição de Cuidado, protocolo no CRM (Serviço Social). O painel mostra um aviso fixo enquanto PRD estiver selecionado. Proteções só de PRD:

- a paciente tem que ser exatamente a de teste ("Mulher Teste") e a única sugestão do autocomplete; se não for, o fluxo para antes de salvar;
- a limpeza automática (passo 0 da criação) não finaliza nada: só a internação criada pela automação é finalizada, no fluxo **Finalizar internação**;
- a validação por API do SAE não é usada (o gateway de PRD não está configurado);
- a internação de teste vai para o prestador de teste e para um médico real escolhido pelo autocomplete (o SAE exige um profissional): finalize ao terminar.

## Temas

Na engrenagem (Configurações) → **Tema**: **Auditoria** (padrão, visual da Cockpit de Auditoria Clínica) ou **Dark**. A escolha fica salva no navegador.

- As fontes Unimed do tema Auditoria não ficam no repositório: ao iniciar, o painel baixa da própria Cockpit (arquivos públicos) para `.estado/fontes/`. Sem acesso, usa a fonte do sistema.
- Os ícones do tema Auditoria são do Font Awesome 7 Free (CDN); sem internet, o painel volta para os ícones próprios.

## Segurança

- Nenhuma senha passa pelo código: o login é sempre manual.
- `.auth/`, `.estado/`, relatórios e traces ficam só na máquina (estão no `.gitignore`), pois guardam sessão e dados de tela.
- Dados digitados pela automação são fictícios e levam o prefixo `[Exemplo]`.
