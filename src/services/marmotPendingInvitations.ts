// User consent for Welcomes is separate from pendingWelcomes (approved joins
// retrying after a transient failure). Nothing here consumes an MLS key.
import type { MarmotGroupSummary, MarmotRumor } from './marmotSession';
import type { MarmotKvBackend } from './marmotStore';

const NS = 'welcomeInvitations';
const RUMOR_WRAPS_NS = 'welcomeInvitationRumorWraps';
export interface PendingMarmotInvitation {
  id: string; // outer wrap id — stable across live/backfill delivery
  rumor: MarmotRumor;
  groupName?: string;
}
type Record =
  | (PendingMarmotInvitation & { status: 'pending' | 'approved' })
  | { id: string; status: 'joined' | 'declined' };
export interface InvitationSession {
  acceptWelcome(rumor: MarmotRumor): Promise<MarmotGroupSummary | null>;
  previewWelcome(rumor: MarmotRumor): Promise<{ group: { name: string } | null }>;
}

export class MarmotPendingInvitations {
  private chain: Promise<unknown> = Promise.resolve();
  constructor(
    private readonly backend: MarmotKvBackend,
    private readonly changed: () => void,
  ) {}
  private serial<T>(task: () => Promise<T>): Promise<T> {
    const run = this.chain.then(task);
    this.chain = run.catch(() => undefined);
    return run;
  }
  private async read(id: string): Promise<Record | null> {
    const raw = await this.backend.get(NS, id);
    return raw ? (JSON.parse(raw) as Record) : null;
  }
  private async write(record: Record): Promise<void> {
    await this.backend.set(NS, record.id, JSON.stringify(record));
    this.changed();
  }
  async list(): Promise<PendingMarmotInvitation[]> {
    await this.chain;
    const records = await Promise.all((await this.backend.keys(NS)).map((id) => this.read(id)));
    return records.filter(
      (r): r is PendingMarmotInvitation & { status: 'pending' } => r?.status === 'pending',
    );
  }
  receive(id: string, rumor: MarmotRumor, followed: boolean): Promise<boolean> {
    return this.serial(async () => {
      if (await this.read(id)) return false;
      // The same inner Welcome can be gift-wrapped again. Keep its original
      // consent/tombstone too, so declining it cannot prompt again under a
      // different outer id. The wrap id remains the primary record key.
      const original = await this.backend.get(RUMOR_WRAPS_NS, rumor.id);
      if (original && (await this.read(original))) return false;
      await this.backend.set(RUMOR_WRAPS_NS, rumor.id, id);
      await this.write({ id, rumor, status: followed ? 'approved' : 'pending' });
      if (!followed) this.log(id, rumor, 'pending (not followed)');
      return !followed;
    });
  }
  // A pending record NEVER upgrades just because contacts later hydrate.
  // Only explicit acceptance changes it to approved.
  resume(session: InvitationSession, isCurrent: () => boolean): Promise<void> {
    return this.serial(async () => {
      for (const id of await this.backend.keys(NS)) {
        if (!isCurrent()) return;
        const record = await this.read(id);
        if (record?.status === 'approved') {
          const group = await session.acceptWelcome(record.rumor);
          if (group && isCurrent()) {
            await this.write({ id, status: 'joined' });
            this.log(id, record.rumor, 'joined');
          }
        } else if (record?.status === 'pending' && record.groupName === undefined) {
          const preview = await session.previewWelcome(record.rumor);
          if (!isCurrent()) return;
          if (preview.group) await this.write({ ...record, groupName: preview.group.name });
        }
      }
    });
  }
  accept(id: string, session: InvitationSession, isCurrent: () => boolean) {
    return this.serial(async () => {
      const record = await this.read(id);
      if (record?.status !== 'pending' || !isCurrent()) return null;
      // Durable consent before handing off to the existing join/consumption
      // logic. Its pendingWelcomes namespace retains transient failures.
      await this.write({ ...record, status: 'approved' });
      this.log(id, record.rumor, 'accepted');
      const group = await session.acceptWelcome(record.rumor);
      if (group && isCurrent()) await this.write({ id, status: 'joined' });
      return isCurrent() ? group : null;
    });
  }
  decline(id: string): Promise<void> {
    return this.serial(async () => {
      const record = await this.read(id);
      if (record?.status !== 'pending') return;
      // Keep only the tombstone, discarding all invitation plaintext.
      await this.write({ id, status: 'declined' });
      this.log(id, record.rumor, 'declined');
    });
  }
  private log(id: string, rumor: MarmotRumor, outcome: string) {
    if (__DEV__)
      console.log(
        `[Marmot] welcome ${id.slice(0, 8)} from ${rumor.pubkey.slice(0, 8)} → ${outcome}`,
      );
  }
}
