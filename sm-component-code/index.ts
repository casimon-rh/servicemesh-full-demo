import express, { Express, Request, Response } from 'express'
import axios from 'axios'

import pinohttp from "pino-http"
import prometheus, { Counter, Registry } from "prom-client"

// Telemetry
import * as opentelemetry from '@opentelemetry/sdk-node';
import { getNodeAutoInstrumentations } from '@opentelemetry/auto-instrumentations-node';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-proto';
import { OTLPMetricExporter } from '@opentelemetry/exporter-metrics-otlp-proto';
import { PeriodicExportingMetricReader } from '@opentelemetry/sdk-metrics';


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

//? ------- OpenTelemetry --------------
const sdk = new opentelemetry.NodeSDK({
  traceExporter: new OTLPTraceExporter({
    // optional - default url is http://localhost:4318/v1/traces
    url: `${process.env.COLLECTOR_ENDPOINT}/v1/traces`,
    // optional - collection of custom headers to be sent with each request, empty by default
    headers: {},
  }),
  metricReader: new PeriodicExportingMetricReader({
    exporter: new OTLPMetricExporter({
      url: `${process.env.COLLECTOR_ENDPOINT}/v1/metrics`, // url is optional and can be omitted - default is http://localhost:4318/v1/metrics
      headers: {}, // an optional object containing custom headers to be sent with each request
    }),
  }),
  instrumentations: [getNodeAutoInstrumentations()],
});

sdk.start();
//? ------- OpenTelemetry --------------

//! ------- Prometheus --------------
let register : Registry<"text/plain; version=0.0.4; charset=utf-8">;
let responseTime: any
let views: Counter

if (process.env.ENABLE_METRICS || false) {
  register = new prometheus.Registry()
  register.setDefaultLabels({
    app: `servicemesh_node_${process.env.ID}`
  })
  responseTime = new prometheus.Gauge({
    name: `servicemesh_node_${process.env.ID}:ch_response_time`,
    help: 'Time take in seconds to response'
  })
  views = new prometheus.Counter({
    name: `servicemesh_node_${process.env.ID}:ch_view_count`,
    help: 'No of page views'
  })
  register.registerMetric(responseTime)
  register.registerMetric(views)
}
//! ------- Prometheus --------------



//* ------- Variables | Messages --------------
const jumps: number = parseInt(process.env.JUMPS || "6")
const curtime = () => `${new Date().getMinutes()}:${new Date().getSeconds()}`
const message = (data: any): CustomResponse => ({
  location: `\nThis is ${process.env.ID} @${curtime()}`,
  data
})
const errmsg = (err: any): CustomResponse => ({
  location: `\nThis is ${process.env.ID} @${curtime()}`,
  error: err || `\n${process.env.ID} @${curtime()} -> unavailable`
})
//* ------- Variables | Messages --------------

//! -------------- Client --------------
const chain = async (endpoint: string, request: Request): Promise<CustomResponse> => {
  try {
    const response = await axios.get(endpoint, { headers: request.headers })
    return message(response.data)
  } catch (err: any) {
    return errmsg(err.response.data)
  }
}
//! -------------- Client --------------

// -------------- Endpoint --------------
app.get('/chain', async (req: Request, res: Response) => {
  let count = (parseInt(`${req.query['count']}`) || 0) + 1
  const endpoint = `${process.env.CHAIN_SVC}?count=${count}`
  let end = undefined
  if (process.env.ENABLE_METRICS || false) {
    responseTime?.setToCurrentTime()
    end = responseTime?.startTimer();
    views?.inc()
  }
  if (count >= jumps) {
    return res.status(200).send(message('\nLast'))
  }
  try {
    const response = await chain(endpoint, req)
    if (end)
      end()
    res.status(200).send(response)
  } catch (error) {
    res.status(200).send(error)
  }
})
app.get('/metrics', async (req: Request, res: Response) => {
  if (process.env.ENABLE_METRICS || false) {
    res.set('Content-Type', register?.contentType)
    res.status(200).send(await register?.metrics())
  } else res.status(404).send({})
})
// -------------- Endpoint --------------
