import { useCallback, useMemo, useState } from 'react';
import { useNostr } from '../contexts/NostrContext';
import { DEFAULT_RELAYS, publishSignedEvent } from '../services/nostrService';
import { COMMENT_KIND, buildCommentTags, type CommentRoot } from '../utils/productComments';
import { buildReviewEvent } from '../utils/productReviews';

export interface UsePublishProductFeedback {
  /** Publish (or replace) the signed-in user's review of a product. */
  publishReview: (input: { coord: string; stars: number; content?: string }) => Promise<void>;
  /** Publish a comment on the product, or a reply to another comment. */
  publishComment: (input: {
    root: CommentRoot;
    content: string;
    reply?: CommentRoot;
  }) => Promise<void>;
  publishing: boolean;
  canPublish: boolean;
}

/**
 * Sign + publish review (kind 31555) and comment (kind 1111) events using the
 * app's existing signer plumbing (`useNostr().signEvent`, which handles both
 * nsec and Amber) and the user's write relays. Throws when not signed in so
 * the caller can surface a sign-in prompt.
 */
export function usePublishProductFeedback(): UsePublishProductFeedback {
  const { signEvent, relays, isLoggedIn } = useNostr();
  const [publishing, setPublishing] = useState(false);

  const writeRelays = useMemo(() => {
    const r = relays.filter((x) => x.write).map((x) => x.url);
    return r.length > 0 ? r : DEFAULT_RELAYS;
  }, [relays]);

  const publish = useCallback(
    async (template: { kind: number; tags: string[][]; content: string }) => {
      setPublishing(true);
      try {
        const signed = await signEvent({
          kind: template.kind,
          created_at: Math.floor(Date.now() / 1000),
          tags: template.tags,
          content: template.content,
        });
        if (!signed) throw new Error('Not signed in');
        await publishSignedEvent(signed, writeRelays);
      } finally {
        setPublishing(false);
      }
    },
    [signEvent, writeRelays],
  );

  const publishReview = useCallback(
    (input: { coord: string; stars: number; content?: string }) => publish(buildReviewEvent(input)),
    [publish],
  );

  const publishComment = useCallback(
    (input: { root: CommentRoot; content: string; reply?: CommentRoot }) =>
      publish({
        kind: COMMENT_KIND,
        content: input.content.trim(),
        tags: buildCommentTags(input.root, input.reply),
      }),
    [publish],
  );

  return { publishReview, publishComment, publishing, canPublish: isLoggedIn };
}
