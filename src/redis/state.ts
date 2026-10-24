type Ticket = { lane: string; requestId: string; generation: number };
/** Independent request lanes share a generation that invalidates old connection/search work. */
export class RequestGate {
  generation = 0;
  private lanes = new Map<string, string>();
  begin(lane: string): Ticket { const requestId = crypto.randomUUID(); this.lanes.set(lane, requestId); return { lane, requestId, generation: this.generation }; }
  current(ticket: Ticket) { return ticket.generation === this.generation && this.lanes.get(ticket.lane) === ticket.requestId; }
  cancel(lane: string) { const id = this.lanes.get(lane); this.lanes.delete(lane); return id; }
  reset() { const ids = [...this.lanes.values()]; this.generation++; this.lanes.clear(); return ids; }
}
