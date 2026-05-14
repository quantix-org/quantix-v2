export interface PeerInfo {
  id: string;
  address: string;
}

export class PeerTable {
  private readonly peers = new Map<string, PeerInfo>();

  addPeer(peer: PeerInfo): void {
    this.peers.set(peer.id, peer);
  }

  listPeers(): PeerInfo[] {
    return [...this.peers.values()];
  }
}
