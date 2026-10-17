import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createMcpServer } from "./mcp-server.js";
import { localClient } from "./local-client.js";
import { dataDirectory } from "./runtime-paths.js";

const api = await localClient();
const server = createMcpServer(api, dataDirectory());
await server.connect(new StdioServerTransport());
