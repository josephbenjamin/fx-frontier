#!/usr/bin/env python3
"""
FX Balance Sheet Monte Carlo Tool Generator
Usage: python generate_fx_tool.py
Output: fx-frontier.html
"""

import os

SRC_DIR = os.path.join(os.path.dirname(__file__), 'src')


def read_src(filename):
    with open(os.path.join(SRC_DIR, filename), 'r', encoding='utf-8') as f:
        return f.read()


def main():
    html = generate_html()
    out = 'fx-frontier.html'
    with open(out, 'w', encoding='utf-8') as f:
        f.write(html)
    print(f"Generated {out}")
    print(f"Open {out} in Chrome, Firefox, or Safari.")


def generate_html():
    css = read_src('styles.css')
    body = read_src('template.html')
    worker_src = read_src('worker.js')
    main_js_template = read_src('main.js')

    # Substitute the worker source into main.js where the placeholder is
    js = main_js_template.replace('// WORKER_SRC_PLACEHOLDER', worker_src)

    return (
        '<!DOCTYPE html>\n<html lang="en">\n<head>\n'
        '<meta charset="UTF-8">\n'
        '<meta name="viewport" content="width=device-width, initial-scale=1.0">\n'
        '<title>FX Balance Sheet Monte Carlo</title>\n'
        '<script src="https://cdn.jsdelivr.net/npm/chart.js@4.4.0/dist/chart.umd.min.js"></script>\n'
        '<script src="https://cdn.jsdelivr.net/npm/hammerjs@2.0.8/hammer.min.js"></script>\n'
        '<script src="https://cdn.jsdelivr.net/npm/chartjs-plugin-zoom@2.0.1/dist/chartjs-plugin-zoom.min.js"></script>\n'
        '<style>\n' + css + '\n</style>\n</head>\n<body>\n'
        + body +
        '\n<script>\n' + js + '\n</script>\n</body>\n</html>'
    )


if __name__ == '__main__':
    main()
