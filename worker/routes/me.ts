// The signed-in account: profile, settings, payment methods and picture, and other
// people's pictures

import { Hono } from 'hono';
import type { Profile } from '../../shared/api';
import { AppEnv, readJson } from '../app';
import { json } from '../http';
import { deleteAvatar, getAvatar, getPaymentQr, putAvatar, putPaymentQr } from '../photos';
import { getProfile, patchProfile, putPaymentMethods } from '../profiles';

const me = new Hono<AppEnv>();

me.get('/me', async (c) => json<Profile>(await getProfile(c.env.DB, c.var.email)));

me.patch('/me', async (c) => {
  const body = await readJson(c.req.raw);
  if (body instanceof Response) return body;
  return patchProfile(c.env.DB, c.var.email, body);
});

me.put('/me/payment-methods', async (c) => {
  const body = await readJson(c.req.raw);
  if (body instanceof Response) return body;
  return putPaymentMethods(c.env.DB, c.var.email, body);
});

me.put('/me/avatar', (c) => putAvatar(c.req.raw, c.env.DB, c.var.email));
me.delete('/me/avatar', (c) => deleteAvatar(c.env.DB, c.var.email));

// A QR code is uploaded first, then saved with its method in the list above
me.put('/me/payment-qr/:id', (c) =>
  putPaymentQr(c.req.raw, c.env.DB, c.var.email, c.req.param('id')),
);
me.get('/payment-qr/:id', (c) => getPaymentQr(c.env.DB, c.var.email, c.req.param('id')));

me.get('/avatars/:email', (c) =>
  getAvatar(c.env.DB, c.var.email, c.req.param('email').toLowerCase()),
);

export default me;
