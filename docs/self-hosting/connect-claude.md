# Connect Claude

freundebuch's MCP endpoint is `${PUBLIC_URL}/mcp`. freundebuch is its own OAuth server (with dynamic client registration), and its sign-in step is your authentik sign-in. There is nothing to copy except the URL.

=== "claude.ai and the Claude apps"

    1. In claude.ai, open **Settings → Connectors → Add custom connector**.
    2. Name it `freundebuch`, URL `https://freundebuch.example.com/mcp`.
    3. **Connect**, then sign in with authentik.

    The connector is available in the desktop and mobile apps as well, including voice mode.

=== "Claude Code"

    ```bash
    claude mcp add --transport http freundebuch https://freundebuch.example.com/mcp
    ```

    Then run `/mcp` in Claude Code and authenticate.

Each person connects their own Claude with their own sign-in. Everything Claude files is recorded as that person, and Claude only sees what that person may see.

## Tool permissions

`record`, `remember`, `relate` and `set_interval` add data and are not marked destructive, so the Claude apps don't ask for confirmation on every ramble. `correct` can delete and is marked destructive. The read tools are read-only. [MCP tools](../reference/mcp-tools.md) lists them all.
