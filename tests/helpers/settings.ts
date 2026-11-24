import {getAuthToken} from 'deepspace'

export async function attemptToggle() {
  const response = await fetch('/api/cueroom/settings', {method:'PUT',
    headers:{Authorization:'Bearer '+await getAuthToken(),'Content-Type':'application/json'},
    body:JSON.stringify({feature:'email',enabled:false})})
  return response.status
}
