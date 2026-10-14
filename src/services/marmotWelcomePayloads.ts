// Preserve the Welcome before the remote signer can fail. The Add is already
// canonical: retry this rumor, never another Add or a refreshed key package.
import type { MarmotGroup, NostrWelcomeDelivery } from '@internet-privacy/marmot-ts';
import { GiftWrapFactory } from 'applesauce-common/factories/gift-wrap';
import type { Rumor } from 'applesauce-common/helpers/gift-wrap';
import type { Event as NostrEvent } from 'nostr-tools';

import type { MarmotDmDeviceSync } from './marmotDmDeviceSync';
import type { MarmotKvBackend } from './marmotStore';
import { WELCOME_OUTBOX_TTL_SECS, type MarmotWelcomeOutbox } from './marmotWelcomeOutbox';

const NS = 'welcomePayloads';
type PendingPayload = {
  groupId: string;
  rumor: Rumor;
  keyPackage: NostrEvent;
  relays: string[];
  queuedAt: number;
};

export class MarmotWelcomePayloads {
  private readonly deliveries = new Map<string, NostrWelcomeDelivery>();
  private readonly running = new Map<string, ReturnType<NostrWelcomeDelivery['deliver']>>();

  constructor(
    private readonly backend: MarmotKvBackend,
    private readonly outbox: MarmotWelcomeOutbox,
    private readonly devices: MarmotDmDeviceSync,
    private readonly stopped: () => boolean,
  ) {}

  attach(group: Pick<MarmotGroup, 'idStr' | 'runtime'>): void {
    const delivery = group.runtime.welcomeDelivery;
    this.deliveries.set(group.idStr, delivery);
    delivery.deliver = async (options) => {
      const item: PendingPayload = {
        groupId: group.idStr,
        rumor: delivery.createRumor(options),
        keyPackage: options.recipient.keyPackageEvent,
        relays: options.groupRelays,
        queuedAt: Math.floor(Date.now() / 1000),
      };
      // Persist before signing/encryption, including before a session stop.
      await this.backend.set(NS, this.id(item), JSON.stringify(item));
      return this.send(item, delivery);
    };
  }

  private id(item: PendingPayload): string {
    return `${item.groupId}:${item.keyPackage.id}`;
  }

  private send(item: PendingPayload, delivery: NostrWelcomeDelivery) {
    const id = this.id(item);
    const existing = this.running.get(id);
    if (existing) return existing;
    const run = this.deliver(item, delivery).finally(() => this.running.delete(id));
    this.running.set(id, run);
    return run;
  }

  private async deliver(item: PendingPayload, delivery: NostrWelcomeDelivery) {
    if (this.stopped()) throw new Error('Marmot session stopped');
    const signer = this.devices.observeSigner(delivery.signer, item.groupId, [item.keyPackage]);
    const event = await GiftWrapFactory.create(signer, item.keyPackage.pubkey, item.rumor);
    let relays = await delivery.network
      .getUserInboxRelays(item.keyPackage.pubkey)
      .catch(() => item.relays);
    if (relays.length === 0) relays = item.relays;
    // Promote to the signed outbox before publishing: further retries need
    // no approval, and a thrown publish cannot lose the invitation either.
    await this.outbox.enqueue(item.groupId, [{ event, relays, recipient: item.keyPackage.pubkey }]);
    await this.backend.remove(NS, this.id(item));
    if (this.stopped()) throw new Error('Marmot session stopped');
    const response = await delivery.network.publish(relays, event);
    if (Object.values(response).some((r) => r.ok)) await this.outbox.remove(event.id);
    return response;
  }

  async drop(groupId: string): Promise<void> {
    this.deliveries.delete(groupId);
    for (const id of await this.backend.keys(NS)) {
      if (id.startsWith(`${groupId}:`)) await this.backend.remove(NS, id);
    }
  }

  /** Remote signers call this only on send; local signers also retry on start/open. */
  async flush(groupId?: string): Promise<void> {
    for (const id of await this.backend.keys(NS)) {
      if (this.stopped()) return;
      const raw = await this.backend.get(NS, id);
      if (!raw) continue;
      const item = JSON.parse(raw) as PendingPayload;
      if (Math.floor(Date.now() / 1000) - item.queuedAt > WELCOME_OUTBOX_TTL_SECS) {
        await this.backend.remove(NS, id);
        continue;
      }
      if (groupId && item.groupId !== groupId) continue;
      if (this.devices.isDeclined(item.groupId, item.keyPackage.id)) continue;
      const delivery = this.deliveries.get(item.groupId);
      // Share the invite capture queue: publishing a retry during another
      // group's capture would otherwise attribute its failed wrap to that group.
      if (delivery)
        await this.outbox.capture(() => this.send(item, delivery)).catch(() => undefined);
    }
  }
}
