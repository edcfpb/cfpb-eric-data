'use strict'

const gulp = require('gulp')
const gls = require('gulp-live-server')


// start express server
gulp.task('start', function () {
  let server = gls.new('app.js')
  server.start()
})
