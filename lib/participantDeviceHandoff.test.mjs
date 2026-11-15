import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const source = readFileSync(new URL('./participantAuth.js', import.meta.url), 'utf8')
  .replace(/^import .*$/gm, '').replace(/export (class|async function|function)/g, '$1')

function fixture(existingId = null, loggedIn = false) {
  const calls = []
  const client = {
    auth:{
      getSession:async () => ({ data:{ session:loggedIn ? { access_token:'old-token' } : null } }),
      signOut:async options => { calls.push(['signOut',options]); return {} },
      signInAnonymously:async () => { calls.push(['anonymous']); return { data:{ session:{ access_token:'new-token' } } } },
    },
    rpc:async name => { calls.push(['rpc',name]); return { data:existingId ? [{ participant_id:existingId }] : [] } },
  }
  const fetch = async (path, options) => {
    calls.push(['claim',path,options.headers.Authorization,JSON.parse(options.body)])
    return { ok:true, json:async () => ({ participant:{ participant_id:'P04',group_id:'B',status:'active' } }) }
  }
  const claim = new Function('getClient','fetch', `${source}\nreturn claimParticipantSession`)(() => client, fetch)
  return { claim,calls }
}

test('fresh device signs in anonymously and claims an existing participant via the server', async () => {
  const f = fixture()
  assert.deepEqual(await f.claim('P04','B'), { participantId:'P04',groupId:'B',status:'active' })
  assert.equal(f.calls[0][0], 'anonymous')
  assert.equal(f.calls.at(-1)[2], 'Bearer new-token')
})

test('a browser previously used for another ID creates a new auth identity instead of stealing that mapping', async () => {
  const f = fixture('P03', true)
  await f.claim('P04','B')
  assert.deepEqual(f.calls.map(call => call[0]), ['rpc','signOut','anonymous','claim'])
  assert.deepEqual(f.calls[1][1], { scope:'local' })
})

test('same browser and same participant keep their existing auth session', async () => {
  const f = fixture('P04', true)
  await f.claim('P04','B')
  assert.deepEqual(f.calls.map(call => call[0]), ['rpc','claim'])
  assert.equal(f.calls.at(-1)[2], 'Bearer old-token')
})
