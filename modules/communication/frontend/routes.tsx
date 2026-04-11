import { Route } from 'react-router-dom'

import ChannelDetailPage from '@modules/communication/frontend/pages/ChannelDetailPage'
import ChannelsPage from '@modules/communication/frontend/pages/ChannelsPage'
import EscalationsPage from '@modules/communication/frontend/pages/EscalationsPage'
import InboxPage from '@modules/communication/frontend/pages/InboxPage'

export function communicationRoutes() {
  return (
    <>
      <Route path="/inbox" element={<InboxPage />} />
      <Route path="/channels" element={<ChannelsPage />} />
      <Route path="/channels/:channelSlug" element={<ChannelDetailPage />} />
      <Route path="/escalations" element={<EscalationsPage />} />
    </>
  )
}
