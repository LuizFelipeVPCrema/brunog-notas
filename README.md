# Notas da Turma

Visualizador de notas por bimestre: importa a planilha do professor, mostra ranking da sala
(nota final e prova bimestral), explica por que cada aluno ficou com a nota que ficou e
acompanha a evolução entre bimestres. Pensado para projetar na TV da sala.

- **frontend/** — Angular 22 (SPA), servido por nginx, que também faz proxy de `/api`.
- **backend/** — Go (chi + pgx), API REST com JWT.
- **Postgres 17** — dados e histórico de alterações de notas.

## Subir na VPS

```bash
cp .env.example .env
# edite .env: POSTGRES_PASSWORD, JWT_SECRET (openssl rand -hex 32) e ADMIN_PASSWORD (12+ caracteres)
docker compose up -d --build
```

O site fica em `http://<ip-da-vps>:${HTTP_PORT}` (padrão 80). Para HTTPS, coloque um proxy
reverso na frente (Caddy, Traefik ou o nginx da própria VPS) apontando para essa porta, e troque
`HTTP_PORT` para algo como `8081` se a 80 já estiver em uso.

Atualizar depois de mudar o código: `git pull && docker compose up -d --build`.
Backup do banco: `docker compose exec db pg_dump -U notas notas > backup.sql`.

## Usuários

Não existe tela de cadastro. Os dois usuários são criados na primeira subida a partir do `.env`:

| Usuário | Senha | Perfil |
|---|---|---|
| `ADMIN_USERNAME` (padrão `admin`) | `ADMIN_PASSWORD` | Administrador (pode redefinir a senha do professor) |
| `Brunog` | `resultadosbimestre` | Professor |

Se um usuário já existe no banco, o `.env` não sobrescreve a senha dele — trocas de senha feitas
em **Conta** permanecem. O login tem limite de tentativas por IP.

## Como usar

1. **Importar** → escolha o bimestre/ano e envie a `.xlsx`. Cada aba vira uma turma; as colunas
   entre `Alunos` e `Total` viram avaliações. `Faltou` vira “Não fez”, `Atestado` no Total marca
   o aluno com atestado (fica fora do ranking). Reimportar é seguro: só o que mudou é gravado.
2. **Turmas** → visão geral do bimestre, top 10 da escola, comparação entre turmas.
3. **Turma** → abas *Ranking* (pódio, nota final ou prova bimestral, setas vs. bimestre anterior),
   *Notas detalhadas* (filtros e o “por quê” de cada nota), *Estatísticas* e *Editar*.
4. **Aluno** → por que a nota foi X, evolução nos bimestres, comparação com o bimestre anterior e
   histórico de alterações.
5. Botões do topo: **Modo TV** (letras grandes, tela cheia, esconde edição), **Nomes curtos**
   (só primeiro nome + inicial, para preservar os alunos na projeção) e tema claro/escuro.

Tipos de avaliação (editáveis na aba *Editar*): a “Prova do professor” é a que entra no ranking da
prova; “Bônus / extra” soma pontos sem contar como ponto perdido. A nota final é limitada a
`MAX_TOTAL` (padrão 10).

## Desenvolvimento

```bash
# Postgres local
docker run -d --name notas-db -e POSTGRES_USER=notas -e POSTGRES_PASSWORD=notas -e POSTGRES_DB=notas -p 5432:5432 postgres:17-alpine

# Backend (porta 8080)
cd backend
DATABASE_URL=postgres://notas:notas@localhost:5432/notas?sslmode=disable \
JWT_SECRET=dev-dev-dev-dev-dev-dev-dev-dev-dev-dev ADMIN_PASSWORD=admin-dev-123456 \
TEACHER_PASSWORD=resultadosbimestre go run ./cmd/server
go test ./...

# Frontend (porta 4200, faz proxy de /api para :8080)
cd frontend && npm install && npm start
```

> As planilhas reais têm nomes de alunos menores de idade: ficam fora do git (`.gitignore`).
