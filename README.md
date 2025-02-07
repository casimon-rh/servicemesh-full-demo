# Service Mesh Demo

## Introduction

Jaeger
Jaeger is an open-source, end-to-end distributed tracing tool that is used for monitoring and troubleshooting microservices-based distributed systems. In the context of a service mesh, Jaeger plays a crucial role in providing observability by tracing requests as they propagate through various services. This helps in identifying performance bottlenecks, understanding service dependencies, and diagnosing issues.

Key features of Jaeger include:

- Distributed Context Propagation: Tracks the flow of requests across service boundaries.
- Latency Optimization: Identifies slow services and operations.
- Root Cause Analysis: Helps in pinpointing the source of errors and performance issues.
- Service Dependency Analysis: Visualizes the interactions between services.

Observability in Service Mesh

Observability in a service mesh involves collecting, processing, and visualizing metrics, logs, and traces to gain insights into the behavior and performance of microservices. It typically includes the following components:

Metrics: Quantitative data about the system's performance, such as request rates, error rates, and latency. Tools like Prometheus are often used to collect and query metrics.
Logs: Detailed records of events that occur within the system. Logs provide context for understanding the state of the system and diagnosing issues.
Traces: Detailed information about the flow of requests through the system, which helps in understanding the interactions between services and identifying bottlenecks.
In a service mesh, observability is enhanced by the sidecar proxies that intercept and collect telemetry data from all service-to-service communication. This data is then sent to observability tools like Jaeger for tracing, Prometheus for metrics, and Elasticsearch for logs.

By integrating Jaeger with a service mesh, you can achieve comprehensive observability, enabling you to monitor, troubleshoot, and optimize your microservices architecture effectively.

## Architecture

We define a generic service that we can later chain in requests with different instances (containers) with slight differences. Note that the number of services is arbitrary, we can have as little as 2 chained services, or as many as we like to test.

Other related libraries involved in this generic service are express and axios, that can help us with REST client-server interactions.

![architecture](./img/6.jpg)


## Technologies

- ArgoCD - Helm
- NodeJS - Express - Typescript
- Openshift Service Mesh - Jaeger

## Detail

The files we have in the repository are standard (index.ts, package\*.json, tsconfig.json) and 4 extra related to the container definition and test scripts.

```docker
FROM registry.access.redhat.com/ubi9/nodejs-18
# WORKDIR /app
COPY --chown=default:root package* .
RUN npm i
COPY --chown=default:root . .
RUN npm run build

EXPOSE 8080
CMD ["npm", "start"]
```

As we can see the container definition uses a base from nodejs on tag 16, defines a workdir in /app directory, runs the installation of packages (with the package\*.json) and after that,i t copies the remaining files into the container, build the typescript source to turn them into js and execute them.

```
node_modules
Dockerfile
docker-compose.yaml
.dockerignore
index.ts
test.http
```

Note: is also relevant for container definition, the exclusions of unwanted files into the container (particularly in the `COPY . .` command)

Now, the typescript code:

```tsx
import express, { Express, Request, Response } from 'express'
import axios from 'axios'
// [...]
interface CustomResponse {
  location: string
  data?: any
  error?: string
}
// ------- ExpressJS --------------
const app: Express = express()
app.use(pinohttp())
app.use(express.json())
app.listen(3000, () => console.log('App listening on port 3000'))
// ------- ExpressJS --------------
// [...]

//! -------------- Client --------------
const chain = async (endpoint: string,  request: Request): Promise<CustomResponse> => {
  // [...] Ommited Jaeger config
  try {
    // [...] Ommited Jaeger config
    const response = await axios.get(endpoint, { headers: request.headers })
    return message(response.data)
  } catch (err: any) {
    return errmsg(err.response.data)
  } finally {
    // [...] Ommited Jaeger config
  }
}
//! -------------- Client --------------

// -------------- Endpoint --------------
app.get('/chain', async (req: Request, res: Response) => {
  const count = (parseInt(`${req.query['count']}`) || 0) + 1
  const endpoint = `${process.env.CHAIN_SVC}?count=${count}`
  responseTime.setToCurrentTime()
  const end = responseTime.startTimer();
  views.inc()
  if (count >= jumps) {
    return res.status(200).send(message('\nLast'))
  }
  try {
    const response = await chain(endpoint, req)
    end()
    res.status(200).send(response)
  } catch (error) {
    res.status(200).send(error)
  }
})
app.get('/metrics', async (req: Request, res: Response) => {
  res.set('Content-Type', register.contentType)
  res.status(200).send(await register.metrics())
})
// -------------- Endpoint --------------
```


## Directories

```

.
├── README.md
├── sm-component-argoapps
│ ├── servicea.yaml
│ ├── serviceb.yaml
│ ├── servicec.yaml
│ └── serviced.yaml
├── sm-component-chart
│ ├── Chart.yaml
│ ├── templates
│ │ ├── \_helpers.tpl
│ │ ├── deployment.yaml
│ │ ├── route.yaml
│ │ └── service.yaml
│ └── values.yaml
├── sm-component-code
│ ├── Dockerfile
│ ├── docker-compose.yaml
│ ├── index.ts
│ ├── package-lock.json
│ ├── package.json
│ ├── test.http
│ └── tsconfig.json
└── sm-component-values
├── service-a.values.yaml
├── service-b.values.yaml
├── service-c.values.yaml
└── service-d.values.yaml

````

## Code Features

### Jaeger integration

Dependencies

- opentelemetry/api
- jaeger-client
- opentracing

```typescript

import { FORMAT_HTTP_HEADERS, Tags } from "opentracing"
// [...]
import Jaeger from "jaeger-client"
// [...]

//? ------- Jaeger --------------
const tracer = () => {
  const options = { logger: pino() }
  const config = {
    serviceName: `servicemesh-node-${process.env.ID}`,
    sampler: {
      type: "const",
      param: 1,
    },
    reporter: {
      logSpans: true,
      collectorEndpoint: process.env.JAEGER_COLLECTOR_ENDPOINT
    }
  }
  const tracer = Jaeger.initTracer(config, options)
  const codec = new Jaeger.ZipkinB3TextMapCodec({ urlEncoding: true })
  tracer.registerInjector(FORMAT_HTTP_HEADERS, codec)
  tracer.registerExtractor(FORMAT_HTTP_HEADERS, codec)
  return tracer
}
const globalTracer = tracer()
//[...]
//! -------------- Client --------------
const chain = async (endpoint: string,  request: Request): Promise<CustomResponse> => {
  const parentSpan = globalTracer.extract(FORMAT_HTTP_HEADERS, request.headers)
  let span: Jaeger.opentracing.Span | null = null
  const spanname= `servicemesh-node-${process.env.ID}:chain`
  if (parentSpan) 
    span = globalTracer.startSpan(spanname, { childOf: parentSpan })
  else 
    span = globalTracer.startSpan(spanname)
  try {
    span.setTag(Tags.SPAN_KIND, Tags.SPAN_KIND_RPC_SERVER)
    span.setTag(Tags.HTTP_METHOD, request.method)
    span.setTag(Tags.HTTP_URL, request.originalUrl)

    globalTracer.inject(span, FORMAT_HTTP_HEADERS, request.headers)
    
    const response = await axios.get(endpoint, { headers: request.headers })
    return message(response.data)
  } catch (err: any) {
    return errmsg(err.response.data)
  } finally {
    span.finish()
  }
}
//! -------------- Client --------------
//? ------- Jaeger --------------

````
