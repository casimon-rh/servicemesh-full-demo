FROM registry.access.redhat.com/ubi10/nodejs-24
# WORKDIR /app
COPY --chown=default:root package* .
RUN npm i
COPY --chown=default:root . .
RUN npm run build

EXPOSE 8080
CMD ["npm", "start"]