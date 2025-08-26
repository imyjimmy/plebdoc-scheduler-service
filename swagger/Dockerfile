FROM swaggerapi/swagger-ui:latest

# Copy custom swagger config
COPY --from=node:alpine /usr/local/bin/node /usr/local/bin/
COPY --from=node:alpine /usr/local/lib/node_modules/npm /usr/local/lib/node_modules/npm
COPY --from=node:alpine /usr/local/bin/npm /usr/local/bin/

# Set API URL to point to our API service
ENV API_URL=http://localhost:3005/api-docs.json
ENV SWAGGER_JSON=/app/swagger.json

# The swagger-ui image will serve the UI
EXPOSE 8080