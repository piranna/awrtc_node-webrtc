#!/usr/bin/env node

import config from 'unify-config'

import bridge from './index.js'


bridge(config())
.then(console.log)
