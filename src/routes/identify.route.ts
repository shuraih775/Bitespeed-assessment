import { Router } from 'express'
import { identifyController } from '../controllers/identify.controller'

export const identifyRouter = Router()

identifyRouter.post('/identify', identifyController)