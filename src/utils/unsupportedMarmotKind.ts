import { classifyAttachment } from './fileAttachment';

export function logUnsupportedMarmotKind(kind: number, pubkey: string, groupId: string) {
  if (__DEV__ && classifyAttachment('', kind) === 'unknown') {
    console.log(
      `[Marmot] unsupported kind ${kind} from ${pubkey.slice(0, 8)} in ${groupId.replace(/^marmot:/, '').slice(0, 8)}`,
    );
  }
}
