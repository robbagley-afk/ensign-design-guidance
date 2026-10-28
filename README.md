# Ensign Design Guidance MCP Server (`ensign-design-guidance`)

Zero-dependency, offline Model Context Protocol (MCP) server providing **Ensign College UI/UX design tokens (ECC v2)**, component styling, Mac Studio architecture rules, and on-device **FERPA compliance scanning**.

Reviewed and architected with the **Opus Specialist** on Microsoft 365 Copilot lane 9230 and powered by Mac Studio resident **LM Studio Gemma 4 26B QAT** (`:1234` / `:4002`).

---

## Capabilities & Tools

1. **`get_design_token_guidance`**
   - Retrieves exact Ensign Career Coach v2 tokens: brand green (`#006645`), hover (`#00503a`), active tint (`#e7f3ee`), identity accent gold (`#FDB515`), Montserrat typography (19–20px body), and 56px control touch targets.
   - Responds in ~2ms from static tables with optional contextual Gemma synthesis.

2. **`get_architecture_guidance`**
   - Instant authoritative lookup of Mac Studio system architecture: port isolation (`1234`, `4002`, `7001`, `8092`, `9230`, `9231`), storage boundaries (Bucket A Work vs. Bucket B Personal/Rental/Church), and two-tier LLM offload rules.

3. **`check_ferpa_compliance`**
   - Dual-layer offline scanner (regex pre-filter + resident Gemma analysis) detecting student PII, IDs, GPAs, and unauthorized network endpoints. 100% loopback; zero cloud tokens. Fails closed if LM Studio is offline.

4. **`ask_design_advisor`** (alias: `ask_resident_gemma`)
   - Queries resident Gemma 4 QAT on port 1234 for offline frontend implementation guidance. Hard-capped to 160 tokens to keep answers concise. Includes a pre-guard against student PII.

---

## Installation & Configuration

### For Claude Code (`~/.claude.json` or project `.mcp.json`)
```json
{
  "mcpServers": {
    "ensign-design-guidance": {
      "command": "node",
      "args": [
        "/Users/robbagley/Local-Infra/mcp-servers/ensign-design-guidance/index.js"
      ]
    }
  }
}
```

### For Antigravity / Gemini (`~/.gemini/config/mcp_config.json`)
```json
{
  "mcpServers": {
    "ensign-design-guidance": {
      "command": "node",
      "args": [
        "/Users/robbagley/Local-Infra/mcp-servers/ensign-design-guidance/index.js"
      ]
    }
  }
}
```

---

## Architectural Principles (Opus Review)

- **Strict `stdout` Isolation:** `stdout` is dedicated exclusively to JSON-RPC 2.0 messages; all logging routes to `stderr`.
- **Static Source of Truth:** Core design tokens and architecture rules answer instantly from disk without depending on model liveness.
- **Fail-Closed Privacy:** The FERPA tool refuses to emit a clean bill of health when offline.
- **Loopback Enforcement:** Inference is structurally hardcoded to `127.0.0.1:1234`.

---

## License
Internal Ensign College Career Services — Rob Bagley
