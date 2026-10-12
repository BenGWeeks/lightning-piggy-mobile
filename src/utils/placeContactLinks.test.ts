import { placeContactLinks } from './placeContactLinks';
import type { BtcMapPlace } from '../services/btcMapService';

const place = (tags: Record<string, string>, phone?: string): BtcMapPlace => ({
  id: 42,
  lat: 0,
  lon: 0,
  tags,
  verified_at: null,
  phone,
});

it.each(['phone', 'contact:phone'])('reads %s and provides a tel link', (key) => {
  expect(placeContactLinks(place({ [key]: ' +44 1234 ' })).phone).toEqual({
    value: '+44 1234',
    href: 'tel:+44 1234',
  });
});
it.each(['website', 'contact:website'])('reads %s and normalises bare domains', (key) => {
  expect(placeContactLinks(place({ [key]: ' example.com ' })).website).toEqual({
    value: 'example.com',
    href: 'https://example.com',
  });
});
it('prefers curated phone and contact website, preserving web schemes', () => {
  expect(
    placeContactLinks(
      place(
        { phone: '1', 'contact:phone': '2', website: 'a.com', 'contact:website': 'http://b.com' },
        '3',
      ),
    ),
  ).toEqual({
    phone: { value: '3', href: 'tel:3' },
    website: { value: 'http://b.com', href: 'http://b.com' },
  });
});
it('hides absent, blank and non-web website values', () => {
  expect(placeContactLinks(place({ phone: ' ', website: ' ' }))).toEqual({
    phone: null,
    website: null,
  });
  expect(placeContactLinks(place({ website: 'javascript:alert(1)' })).website).toBeNull();
});
