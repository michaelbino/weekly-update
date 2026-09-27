# Test/render image. No dependencies beyond Node's standard library.
FROM node:20-alpine
WORKDIR /app
COPY package.json ./
COPY apps-script ./apps-script
COPY cli ./cli
COPY template ./template
COPY test ./test
USER node
CMD ["npm", "test"]
