'use strict'

var Stream = require( 'stream' )
var debug = require( 'debug' )( 'pipage' )

/**
 * @class Pipeline
 * @extends {Stream.Duplex}
 * @summary Create a stream pipeline
 * @param {Stream[]} [streams]
 * @param {Object} [options]
 * @param {Number} [options.highWaterMark=16384]
 * @param {Boolean} [options.allowHalfOpen=true]
 * @param {Boolean} [options.objectMode=false]
 * @param {Boolean} [options.readableObjectMode=false]
 * @param {Boolean} [options.writableObjectMode=false]
 * @see https://nodejs.org/api/stream.html#stream_new_stream_duplex_options
 * @returns {Pipeline}
 */
class Pipeline extends Stream.Duplex {

  constructor( streams, options ) {

    if( !Array.isArray(streams) ) {
      options = streams
      streams = null
    }

    super(options)

    var self = this

    this._streams = []

    this._endHandler = () => {
      this.push( null )
    }

    this._readHandler = () => {
      this.emit( '_read' )
    }

    this._errorHandler = function( error ) {
      error.stream = this
      self.emit( 'error', error )
    }

    this.on( 'finish', () => {
      if( this._streams.length ) {
        this._streams[0].end()
      } else {
        this.push( null )
      }
    })

    this.on( 'end', () => {
      debug( 'ended' )
    })

    if(Array.isArray(streams)) {
      this.splice.apply( this, [ 0, 0 ].concat( streams ) )
    }

  }

  /** @type {Number} length */
  get length() {
    return this._streams.length
  }

  /**
   * Unpipe & unbind events before
   * mutating the internal pipeline
   * @private
   * @returns {undefined}
   */
  _beforeMutate() {

    if( this._streams.length ) {
      this._streams[ this._streams.length - 1 ]
        .removeListener( 'readable', this._readHandler )
        .removeListener( 'end', this._endHandler )
    }

    this._streams.forEach(( stream, i ) => {
      const next = this._streams[i+1]
      if(next) {
        stream.unpipe(next)
      }
    })

  }

  /**
   * Re-pipe & bind events after
   * mutating the internal pipeline
   * @private
   * @returns {undefined}
   */
  _afterMutate() {

    if( this._streams.length ) {
      this._streams[ this._streams.length - 1 ]
        .on( 'readable', this._readHandler )
        .on( 'end', this._endHandler )
    }

    this._streams.forEach(( stream, i ) => {
      const next = this._streams[i+1]
      if(next) {
        stream.pipe(next)
      }
    })

  }

  /**
   * Read data from the end of the stream
   * @private
   * @returns {undefined}
   */
  _read() {

    const stream = this._streams[ this._streams.length - 1 ]

    if( !stream ) return;

    let chunk = null
    let reads = 0

    while( (chunk = stream.read()) != null ) {
      reads++
      if( !this.push( chunk ) ) {
        break
      }
    }

    if( reads === 0 ) {
      this.once( '_read', () => {
        this._read()
      })
    }

  }

  /**
   * Send data into the underlying streams
   * @private
   * @param {*} chunk
   * @param {String} encoding
   * @param {Function} next(error,chunk)
   * @returns {Boolean}
   */
  _write(chunk, encoding, next) {

    if( !this._streams.length ) {
      this.push( chunk, encoding )
      return next()
    }

    return this._streams[0].write( chunk, encoding, next )

  }

  /**
   * End the pipeline
   * @param {*} chunk
   * @param {String} encoding
   * @param {Function} callback – called on 'finish'
   * @returns {undefined}
   */
  end(chunk, encoding, callback) {

    debug('end')

    if( callback ) {
      this.once( 'finish', callback )
    }

    Stream.Duplex.prototype.end.call( this, chunk, encoding, () => {
      debug( 'finished' )
    })

  }

  /**
   * Bind to a stream's events, and re-emit them on the pipeline
   * @param {Stream} stream
   * @param {String|Array} events
   * @returns {Pipeline}
   * @chainable
   */
  bind( stream, events ) {

    var self = this

    events = [].concat( events )

    debug( 'bind', events )

    // Track bound events on the stream, to enable removal etc.
    stream._pipageListeners = stream._pipageListeners || {}

    events.forEach( function( event ) {

      // Prevent double-binding events
      if( stream._pipageListeners[ event ] != null ) {
        return
      }

      stream._pipageListeners[ event ] = function() {
        var argv = Array.prototype.slice.call( arguments )
        return self.emit.apply( self, [ event ].concat( argv ) )
      }

      stream.on( event, stream._pipageListeners[ event ] )

    })

    return this

  }

  /**
   * Unbind the pipeline from a stream's event(s)
   * @param {Stream} stream
   * @param {String|Array} events
   * @returns {Pipeline}
   * @chainable
   */
  unbind( stream, events ) {

    if( stream._pipageListeners == null ) {
      return this
    }

    events = [].concat( events )

    events.forEach( function( event ) {
      if( stream._pipageListeners[ event ] == null ) return
      stream.removeListener( event, stream._pipageListeners[ event ] )
      stream._pipageListeners[ event ] = null
    })

    return this

  }

  /**
   * Unbind the pipeline from all of a stream's bound events
   * @param {Stream} stream
   * @returns {Pipeline}
   * @chainable
   */
  unbindAll( stream ) {

    if( stream._pipageListeners ) {
      this.unbind( stream, Object.keys( stream._pipageListeners ) )
      stream._pipageListeners = null
    }

    return this

  }

  /**
   * Get a stream in the pipeline by index
   * @todo support nested pipelines, i.e. `pipeline.get(3,2,5)`
   * @param {Number} index - stream's index
   * @returns {Stream} stream
   */
  get( index ) {
    index = index >= 0 ? index : this._streams.length + index
    return this._streams[ index ]
  }

  /**
   * Get the index of a given stream in the pipeline
   * @param {Stream} stream
   * @param {Number} [fromIndex]
   * @returns {Number} index
   */
  indexOf( stream, fromIndex ) {
    return this._streams.indexOf( stream, fromIndex )
  }

  /**
   * Get the last index of a given stream in the pipeline
   * @param {Stream} stream
   * @param {Number} [fromIndex]
   * @returns {Number} index
   */
  lastIndexOf( stream, fromIndex ) {
    return this._streams.lastIndexOf( stream, fromIndex )
  }

  /**
   * Append given streams to the pipeline, analog to Array#push()
   * @param  {...Stream} streams - streams to append
   * @returns {Number} length
   */
  append() {
    var streams = Array.prototype.slice.call( arguments )
    this.splice.apply( this, [ this._streams.length, 0 ].concat( streams ) )
    return this.length
  }

  /**
   * Prepend given streams to the pipeline, analog to Array#unshift()
   * @param  {...Stream} streams - streams to prepend
   * @returns {Number} length
   */
  prepend() {
    var streams = Array.prototype.slice.call( arguments )
    this.splice.apply( this, [ 0, 0 ].concat( streams ) )
    return this.length
  }

  /**
   * Shift a stream off of the beginning of the pipeline
   * @returns {Stream} stream
   */
  shift() {
    return this.splice( 0, 1 )[0]
  }

  /**
   * Pop a stream off of the end of the pipeline
   * @returns {Stream} stream
   */
  pop() {
    return this.splice( this._streams.length - 1, 1 )[0]
  }

  /**
   * Insert given streams into the pipeline at a given index
   * @param {Number} index
   * @param {...Stream} streams
   * @returns {Number} length
   */
  insert( index ) {

    if( typeof index !== 'number' ) {
      throw new Error( 'Insertion index must be a number' )
    }

    var streams = Array.prototype.slice.call( arguments, 1 )
    var argv = [ index, 0 ].concat( streams )

    this.splice.apply( this, argv )

    return this.length

  }

  /**
   * Remove a given stream from the pipeline
   * @param {Stream} stream
   * @returns {Stream|null} removed stream
   */
  remove( stream ) {
    var index = this.indexOf( stream )
    return ~index ? this.splice( index, 1 )[0] : null
  }

  /**
   * Splice streams into or out of the pipeline
   * @param {Number} index - starting index for removal / insertion
   * @param {Number} remove - how many streams to remove
   * @param {...Stream} streams - streams to be inserted
   * @returns {Stream[]} removed streams
   */
  splice( index, remove ) {

    // Support negative indices
    index = index >= 0 ? index : this._streams.length + index

    // Default to removal of everything > index
    remove = remove != null ? remove : this._streams.length - index
    remove = Math.max( 0, Math.min( this._streams.length - index, remove ) )

    var lastIndex = index + remove
    var streams = Array.prototype.slice.call( arguments, 2 )

    debug( 'splice @%s/%s -%s +%s', index, this._streams.length, remove, streams.length )

    this._beforeMutate()

    streams.forEach(( stream ) => {
      stream.on( 'error', this._errorHandler )
    })

    // Splice streams in/out
    var removed = this._streams.splice.apply( this._streams, [ index, remove ].concat( streams ) )

    removed.forEach(( stream ) => {
      stream.removeListener( 'error', this._errorHandler )
      this.unbindAll(stream)
    })

    this._afterMutate()

    return removed

  }

}

// Exports
module.exports = Pipeline
