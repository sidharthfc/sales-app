### Route Sales

Route Sales Management System for an electrical and plumbing trading company —
route-based field sales, delivery, and collections, plus an admin console.

This repo has two parts:

- **`route_sales/`** — the Frappe app: DocTypes, whitelisted API endpoints,
  patches, fixtures. Installed like any other Frappe app.
- **`frontend/`** — the Route Sales PWA (React + Vite), built to
  `route_sales/public/frontend/` and served at `/route_sales` by
  `route_sales/www/route_sales.py`. See `route_sales/hooks.py`'s
  `website_route_rules` for the routing.

### Installation

```bash
cd $PATH_TO_YOUR_BENCH
bench get-app route_sales $URL_OF_THIS_REPO --branch version-16
bench install-app route_sales
```

`bench build` (run automatically on install, or manually afterwards) builds
the PWA via the root `package.json`'s `build` script, which installs and
builds `frontend/`. To work on the frontend directly:

```bash
cd frontend
npm install
npm run dev      # local dev server, proxies /api to localhost:8000
npm run build    # production build -> ../route_sales/public/frontend/
npm run lint
npm test
```

### Contributing

This app uses `pre-commit` for code formatting and linting. Please [install pre-commit](https://pre-commit.com/#installation) and enable it for this repository:

```bash
cd apps/route_sales
pre-commit install
```

Pre-commit is configured to use the following tools for checking and formatting your code:

- ruff, pyupgrade — Python
- eslint, prettier — `route_sales/public/js/` only; `frontend/` lints and
  formats itself via its own `eslint.config.js` (`npm run lint`)

### CI

GitHub Actions is configured for this repo (`.github/workflows/`):

- **CI** (`ci.yml`): on push to `version-16` and on pull requests — installs
  this app on a fresh bench and runs the Python test suite, and separately
  installs/lints/tests/builds `frontend/`.
- **Linters** (`linter.yml`): on pull requests — runs
  [Frappe Semgrep Rules](https://github.com/frappe/semgrep-rules) and
  [pip-audit](https://pypi.org/project/pip-audit/).

### License

mit
