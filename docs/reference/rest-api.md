# REST API

The MCP tools and the web app share the same domain functions, and they are available over REST at `${PUBLIC_URL}/api/v1` as well.

## Authentication

Use one of:

- an OAuth access token issued for the resource `${PUBLIC_URL}/api/v1` (tokens issued for `/mcp` are not accepted here, and the other way round), or
- from the instance's own pages, the sign-in cookie. Requests with the cookie must send a matching `Origin` header.

## OpenAPI

The OpenAPI description is generated from the route table and served at `/api/v1/openapi.json` (sign-in required). The same file is committed as [`openapi.json`](https://github.com/Marceltov/freundebuch/blob/main/openapi.json) in the repository.

## Example

```bash
curl -H "Authorization: Bearer $TOKEN" https://freundebuch.example.com/api/v1/people
```

The same privacy rules apply as everywhere else: a request sees what the token's person may see.
