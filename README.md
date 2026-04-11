# FX Frontier

A Monte Carlo simulation tool for analysing FX impact on a company's balance sheet. Run the Python script once to generate a fully self-contained HTML file — no server, no dependencies, works offline in any modern browser.

## What it does

- Models how exchange rate moves affect **equity** and **leverage** for a multi-currency balance sheet
- Exhaustively generates every possible debt currency allocation scenario at a configurable step size
- Runs thousands of correlated log-normal FX paths per scenario, calibrated to your spot, forward, and volatility inputs
- Plots an **efficient frontier** across scenarios so you can identify which debt currency mixes are most resilient to adverse FX moves
- Compares an overlay scenario against your existing allocation with EaR / LaR risk stats

## Usage

Requires Python 3.12+. No third-party packages needed.

```bash
python generate_fx_tool.py
```

This writes `fx-frontier.html` to the current directory. Open it in Chrome, Firefox, or Safari.

### With uv

```bash
uv run generate_fx_tool.py
```

## Inputs (configured in the browser)

| Tab | What you set |
|-----|-------------|
| Company Setup | Reporting currency, net debt, NAV, EBITDA, currency selection, allocation sliders |
| FX Parameters | Spot rates, 1Y forwards, annual vol, correlation matrix |
| Scenarios & Run | Step size (5–50%), number of Monte Carlo paths |
| Results | Interactive charts, overlay scenario comparison, risk stats |

## Output

The generated HTML file is standalone — embed it, share it, or open it directly from the repo. All simulation runs entirely in the browser (Web Workers).
