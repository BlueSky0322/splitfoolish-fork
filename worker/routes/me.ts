// The signed-in account: profile, settings, payment methods and picture, and other
// people's pictures

import { Hono } from 'hono';
import type { PaymentMethodsBody, Profile, ProfilePatch } from '../../shared/api';
import type { AppEnv } from '../app';
import { json, readJson } from '../http';
import {
  deleteAvatar,
  putAvatar,
  putPaymentQr,
  serveAvatar,
  servePaymentQr,
} from '../photos/pictures';
import { getProfile, patchProfile, putPaymentMethods } from '../accounts/profiles';
import { ROW_ID_PARAM } from '../app';

const me = new Hono<AppEnv>();

me.get('/me', async (c) => json<Profile>(await getProfile(c.env.DB, c.var.email)));

me.patch('/me', async (c) => {
  const body = await readJson<ProfilePatch>(c.req.raw);
  if (body instanceof Response) return body;
  return patchProfile(c.env.DB, c.var.email, body);
});

me.put('/me/payment-methods', async (c) => {
  const body = await readJson<PaymentMethodsBody>(c.req.raw);
  if (body instanceof Response) return body;
  return putPaymentMethods(c.env.DB, c.var.email, body);
});

me.put('/me/avatar', (c) => putAvatar(c.env.DB, c.var.email, c.req.raw));
me.delete('/me/avatar', (c) => deleteAvatar(c.env.DB, c.var.email));

// A QR code is uploaded first, then saved with its method in the list above
me.put(`/me/payment-qr/:id${ROW_ID_PARAM}`, (c) =>
  putPaymentQr(c.env.DB, c.req.param('id'), c.var.email, c.req.raw),
);
me.get(`/payment-qr/:id${ROW_ID_PARAM}`, (c) =>
  servePaymentQr(c.env.DB, c.req.param('id'), c.var.email),
);

me.get('/avatars/:email', (c) =>
  serveAvatar(c.env.DB, c.req.param('email').toLowerCase(), c.var.email),
);

export default me;
