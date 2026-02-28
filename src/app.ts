import express from 'express'
import { identifyRouter } from './routes/identify.route'

export const app = express()

app.use(express.json())

app.use('/', identifyRouter)