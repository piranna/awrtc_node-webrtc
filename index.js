import {once} from 'events'

import {Client} from 'awrtc_signaling/client.js'
import ffmpeg from 'fluent-ffmpeg'
import wrtc from 'wrtc'
import {input} from 'wrtc-to-ffmpeg'

const {nonstandard: {RTCAudioSink, RTCVideoSink}, RTCPeerConnection} = wrtc


function stringToBuffer(str)
{
  let buf = new ArrayBuffer(str.length * 2);
  let bufView = new Uint16Array(buf);
  for (var i = 0, strLen = str.length; i < strLen; i++) {
      bufView[i] = str.charCodeAt(i);
  }

  return new Uint8Array(buf);
}


export default function({signaling_ws, streamName})
{
  function onDisconnected({connectionId: {id}})
  {
    delete peerConnections[id]
  }

  function onReliableMessageReceived({connectionId: {id}, messageData})
  {
    const peerConnection = peerConnections[id]
    if(!peerConnection) return console.warn('Unknown peerConnection id:', id)

    messageData = new TextDecoder("utf-16").decode(messageData)
    const message = JSON.parse(messageData)

    console.debug('ReliableMessageReceived:', message)

    if(message.sdp)
      return peerConnection.setRemoteDescription(message)
      .catch(console.error)

    if(message.candidate)
      return peerConnection.addIceCandidate(message)
      .catch(console.error)

    console.warn('Unknown message format:', message)
  }

  const peerConnections = {}
  const signalingClient = new Client(signaling_ws)

  signalingClient.addEventListener('close', console.warn.bind(null, 'close'))  // TODO reconnect with signaling server
  signalingClient.addEventListener('error', function({error})
  {
    console.error(error)
  })
  signalingClient.addEventListener('Disconnected', onDisconnected)
  signalingClient.addEventListener('ReliableMessageReceived',
    onReliableMessageReceived)
  signalingClient.addEventListener('UnreliableMessageReceived',
    console.warn.bind(null, 'UnreliableMessageReceived'))  // TODO reject all unreliable messages

  return once(signalingClient, 'open')
  .then(function()
  {
    console.log('Connected to signaling server')

    function onNewConnection({connectionId})
    {
      console.info('NewConnection:', connectionId)

      const recorder = ffmpeg()
      let numTracks = 0

      // Create PeerConnection
      const peerConnection = new RTCPeerConnection()

      peerConnection.addEventListener('track', function({track})
      {
        input(track).then(function({options, url})
        {
          console.log('url:', url, options)
          recorder.input(url).inputOptions(options)

          if(++numTracks == 2)
          {
            recorder.output('./myVideo.mp4')
            .on('stderr', (line) => {
              console.log(line);
            })
            .on('start', cmd => {
              console.log(cmd)
            })
            .run()
          }
        })

        // switch(track.kind)
        // {
        //   case 'audio':
        //   {
        //     const sink = new RTCAudioSink(track)

        //     sink.ondata = ({ frame }) => {
        //       console-debug('audio data:', frame)
        //     }

        //     // sink.stop()
        //   }
        //   break

        //   case 'video':
        //   {
        //     const sink = new RTCVideoSink(track)

        //     sink.onframe = ({ frame }) => {
        //       console-debug('video frame:', frame)
        //     }

        //     // sink.stop()
        //   }
        //   break

        //   default: throw new Error(`Unknown track kind: '${track.kind}'`)
        // }
      })

      const audioTransceiver = peerConnection.addTransceiver('audio');
      const videoTransceiver = peerConnection.addTransceiver('video');

      peerConnection.createOffer()
      .then(peerConnection.setLocalDescription.bind(peerConnection))
      .then(function()
      {
        console.log(peerConnection.localDescription)

        let message = peerConnection.localDescription

        console.debug('send:', message)

        message = JSON.stringify(message)
        message = stringToBuffer(message)

        signalingClient.sendReliableMessage(connectionId, message)
      }, console.error)

      peerConnections[connectionId.id] = peerConnection
    }

    signalingClient.addEventListener('NewConnection', onNewConnection)

    return signalingClient.StartServer(streamName)
  })
}
