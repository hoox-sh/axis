// Copyright (C) 2026 jango_blockchained
//
// This file is part of AXIS IDE (hoox-sh.axis-ide).
//
// AXIS IDE is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License as published by
// the Free Software Foundation, version 3 of the License only.
//
// AXIS IDE is distributed in the hope that it will be useful,
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU Affero General Public License for more details.
//
// You should have received a copy of the GNU Affero General Public License
// along with AXIS IDE.  If not, see <https://www.gnu.org/licenses/>.
//
// SPDX-License-Identifier: AGPL-3.0-only

export { decode, encode, isHostToView, isViewToHost } from './codec';
export {
  ALL_MESSAGE_TYPES,
  HOST_TO_VIEW,
  HOST_TO_VIEW_TYPES,
  KNOWN_TYPES,
  PROTOCOL_ERROR_CODES,
  PROTOCOL_VERSION,
  SECTION_6_MESSAGE_TYPES,
  VIEW_TO_HOST,
  VIEW_TO_HOST_TYPES,
  WEBVIEW_VIEWS,
  WEBVIEW_VIEW_SET,
  type AxisEnvelope,
  type ChartDeltaPayload,
  type ChartDrawingApplyPayload,
  type ChartFullPayload,
  type ChartInitPayload,
  type ChartRequestReloadPayload,
  type ChartThemePayload,
  type ChartViewportPayload,
  type DecodeErr,
  type DecodeOk,
  type DecodeResult,
  type DrawingCommitPayload,
  type DrawingSetToolPayload,
  type EncodeOptions,
  type HostErrorPayload,
  type HostRunStatusPayload,
  type HostToViewType,
  type MessageType,
  type PayloadByType,
  type ProtocolError,
  type ProtocolErrorCode,
  type ResultsFocusPayload,
  type ResultsReadyPayload,
  type ResultsSetPayload,
  type ViewToHostType,
  type WebviewReadyPayload,
  type WebviewView,
} from './types';
