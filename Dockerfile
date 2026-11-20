FROM node:26-slim
WORKDIR /app
COPY mcp-stdio.mjs ./
USER node
CMD ["node", "mcp-stdio.mjs"]
