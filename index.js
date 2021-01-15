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
        .on('start' , cmd  => console.log(cmd))
        .on('stderr', line => console.log(line))

      // // Re-encoding
      // .complexFilter([
      //   'split=3[vtemp001][vtemp002]',
      //   '[vtemp001]scale=960:trunc(ow/a/2)*2[vout001]',
      //   '[vtemp002]scale=1280:trunc(ow/a/2)*2[vout002]'
      //   '[vtemp003]scale=1920:trunc(ow/a/2)*2[vout003]'
      // ])

      // // Playlists
      // .videoCodec('libx264')
      // .videoBitrate(2000)

      // .videoCodec('libx264')
      // .videoBitrate(4000)

      // Master playlist
      .output('./hls/myVideo_%v.m3u8')
        .format('hls')
        .outputOptions([
          '-c:v:0 libx264', '-b:v:0 4000k',

          // // Playlists
          // '-map [vout001]', '-c:v:0 libx264', '-b:v:0 1000k',
          // '-map [vout002]', '-c:v:1 libx264', '-b:v:1 2000k',
          // '-map [vout003]', '-c:v:1 libx264', '-b:v:1 4000k',

          '-g 6',
          // '-hls_flags delete_segments',
          '-hls_time 4',
          '-hls_playlist_type vod',
          // `-hls_segment_filename %03d.ts`,
          // '-hls_base_url http://localhost:8080/'
          '-master_pl_name myVideo.m3u8',
          // '-var_stream_map','"v:0 v:1"'
        ])

      let numTracks = 0

      // Create PeerConnection
      const peerConnection = new RTCPeerConnection()

      peerConnection.addEventListener('track', function({track})
      {
        input(track, 3).then(function({options, url})
        {
          recorder.input(url).inputOptions(options)

          if(++numTracks === 2) recorder.run()
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
