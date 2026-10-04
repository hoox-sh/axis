// Copyright (c) 2026 HOOX · AXIS · hoox-sh (jango_blockchained)
//
// This file is part of axis.
//
// SPDX-License-Identifier: AGPL-3.0-only

export { runHpoStudy, persistStudy, loadPersistedStudy } from './client';
export { beginStudy, endStudy, isStudyActive } from './guard';
export { defaultParamFromInput, spaceReady, randomAssignment, toPyneSpace } from './space';
export type { ParamSpec, StudySnapshot, SamplerId, ObjectiveId, ValidationSpec } from './types';
export { MAX_TRIALS } from './types';
