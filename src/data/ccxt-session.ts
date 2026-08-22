// Copyright (C) 2024-2026 jango_blockchained
//
// This file is part of pynescript.
//
// pynescript is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.
//
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Bind / unbind CCXT keys on the datafeed gateway.
 *
 * Secrets stay in the browser vault and in a JSON POST body. Subsequent
 * OHLCV/watch calls only send the credential **id** (`cred=`), never the key.
 *
 * @module data/ccxt-session
 */

import {
  ccxtCredentialId,
  getCcxtCredential,
} from './credentials';
import {
  gatewayDeleteSession,
  gatewayPutSession,
  type GatewayMode,
} from './gateway';

export async function bindCcxtSession(
  mode: GatewayMode,
  exchange: string,
): Promise<string | undefined> {
  const ex = String(exchange || '').trim().toLowerCase();
  if (!ex) return undefined;
  const cred = getCcxtCredential(ex);
  if (!cred?.apiKey || !cred.secret) return undefined;
  try {
    await gatewayPutSession(mode, {
      exchange: ex,
      credentialId: cred.id,
      apiKey: cred.apiKey,
      secret: cred.secret,
      password: cred.passphrase,
      uid: cred.uid,
    });
    return cred.id;
  } catch {
    // Public OHLCV still works; hosted PYNE may reject client-supplied keys.
    return undefined;
  }
}

export async function unbindCcxtSession(mode: GatewayMode, exchange: string): Promise<void> {
  const ex = String(exchange || '').trim().toLowerCase();
  if (!ex) return;
  await gatewayDeleteSession(mode, ccxtCredentialId(ex));
}
