.PHONY: dev test typecheck db-generate db-migrate db-seed smoke

dev:
	pnpm dev

test:
	pnpm test

typecheck:
	pnpm typecheck

db-generate:
	pnpm db:generate

db-migrate:
	pnpm db:migrate

db-seed:
	pnpm db:seed

smoke:
	pnpm smoke
