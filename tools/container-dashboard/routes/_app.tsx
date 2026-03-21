import { type PageProps } from "$fresh/server.ts";

export default function App({ Component }: PageProps) {
  return (
    <html>
      <head>
        <meta charset="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1.0" />
        <title>Deno Containers</title>
        <style>{`
          * { margin: 0; padding: 0; box-sizing: border-box; }
          body {
            font-family: 'SF Mono', 'Menlo', 'Monaco', 'Courier New', monospace;
            background: #0a0a0a;
            color: #e0e0e0;
            min-height: 100vh;
          }
          .header {
            background: #111;
            border-bottom: 1px solid #333;
            padding: 16px 24px;
            display: flex;
            align-items: center;
            gap: 12px;
          }
          .header h1 {
            font-size: 18px;
            font-weight: 600;
            color: #fff;
          }
          .header .badge {
            background: #1a3a2a;
            color: #4ade80;
            font-size: 11px;
            padding: 2px 8px;
            border-radius: 10px;
            font-weight: 500;
          }
          .header .pid {
            margin-left: auto;
            color: #666;
            font-size: 12px;
          }
          .content { padding: 24px; }
          table {
            width: 100%;
            border-collapse: collapse;
            font-size: 13px;
          }
          th {
            text-align: left;
            padding: 8px 12px;
            color: #888;
            font-weight: 500;
            font-size: 11px;
            text-transform: uppercase;
            letter-spacing: 0.5px;
            border-bottom: 1px solid #222;
          }
          td {
            padding: 10px 12px;
            border-bottom: 1px solid #1a1a1a;
          }
          tr:hover td { background: #111; }
          .type-badge {
            display: inline-block;
            padding: 2px 8px;
            border-radius: 4px;
            font-size: 11px;
            font-weight: 600;
          }
          .type-run { background: #1a2a3a; color: #60a5fa; }
          .type-cron { background: #2a1a3a; color: #c084fc; }
          .btn {
            background: none;
            border: 1px solid #333;
            color: #aaa;
            padding: 4px 10px;
            border-radius: 4px;
            cursor: pointer;
            font-size: 11px;
            font-family: inherit;
            transition: all 0.15s;
          }
          .btn:hover { border-color: #555; color: #fff; }
          .btn-danger:hover { border-color: #f87171; color: #f87171; }
          .btn-primary { border-color: #60a5fa; color: #60a5fa; }
          .btn-primary:hover { background: #60a5fa22; }
          .empty {
            text-align: center;
            padding: 60px 20px;
            color: #555;
          }
          .empty p { margin-top: 8px; font-size: 13px; }
          .log-panel {
            background: #111;
            border: 1px solid #222;
            border-radius: 8px;
            margin-top: 20px;
            overflow: hidden;
          }
          .log-header {
            padding: 12px 16px;
            border-bottom: 1px solid #222;
            display: flex;
            align-items: center;
            justify-content: space-between;
          }
          .log-header h3 { font-size: 14px; color: #fff; }
          .log-body {
            padding: 12px;
            max-height: 500px;
            overflow-y: auto;
            font-size: 12px;
            line-height: 1.6;
          }
          .log-line { white-space: pre-wrap; word-break: break-all; }
          .log-ts { color: #555; }
          .log-LOG { color: #e0e0e0; }
          .log-ERR { color: #f87171; }
          .log-WRN { color: #fbbf24; }
          .log-INF { color: #60a5fa; }
          .log-DBG { color: #888; }
          .level-tag {
            display: inline-block;
            width: 32px;
            text-align: center;
            font-size: 10px;
            font-weight: 600;
          }
          .stats-row {
            display: flex;
            gap: 24px;
            margin-bottom: 20px;
          }
          .stat-card {
            background: #111;
            border: 1px solid #222;
            border-radius: 8px;
            padding: 16px 20px;
            min-width: 120px;
          }
          .stat-card .label {
            font-size: 11px;
            color: #666;
            text-transform: uppercase;
            letter-spacing: 0.5px;
          }
          .stat-card .value {
            font-size: 28px;
            font-weight: 700;
            color: #fff;
            margin-top: 4px;
          }
        `}</style>
      </head>
      <body>
        <Component />
      </body>
    </html>
  );
}
