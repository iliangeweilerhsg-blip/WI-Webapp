/* GENERIERT aus packages/schemas/src – nicht von Hand ändern. Neu erzeugen: pnpm schemas:gen */
/* eslint-disable @typescript-eslint/no-unused-vars */
import type { z } from 'zod';
import type * as T from './types.ts';
import type * as Z from './zod.ts';

type Equal<A, B> = (<X>() => X extends A ? 1 : 2) extends <X>() => X extends B ? 1 : 2 ? true : false;

const _ApiError: Equal<z.infer<typeof Z.ApiErrorSchema>, T.ApiError> = true;
const _ApiErrorBody: Equal<z.infer<typeof Z.ApiErrorBodySchema>, T.ApiErrorBody> = true;
const _BBox: Equal<z.infer<typeof Z.BBoxSchema>, T.BBox> = true;
const _ExerciseSheet: Equal<z.infer<typeof Z.ExerciseSheetSchema>, T.ExerciseSheet> = true;
const _ExerciseSheetList: Equal<z.infer<typeof Z.ExerciseSheetListSchema>, T.ExerciseSheetList> = true;
const _ExerciseSheetUpdate: Equal<z.infer<typeof Z.ExerciseSheetUpdateSchema>, T.ExerciseSheetUpdate> = true;
const _Health: Equal<z.infer<typeof Z.HealthSchema>, T.Health> = true;
const _IngestState: Equal<z.infer<typeof Z.IngestStateSchema>, T.IngestState> = true;
const _IsoDate: Equal<z.infer<typeof Z.IsoDateSchema>, T.IsoDate> = true;
const _Job: Equal<z.infer<typeof Z.JobSchema>, T.Job> = true;
const _JobList: Equal<z.infer<typeof Z.JobListSchema>, T.JobList> = true;
const _JobState: Equal<z.infer<typeof Z.JobStateSchema>, T.JobState> = true;
const _JobType: Equal<z.infer<typeof Z.JobTypeSchema>, T.JobType> = true;
const _Lang: Equal<z.infer<typeof Z.LangSchema>, T.Lang> = true;
const _Module: Equal<z.infer<typeof Z.ModuleSchema>, T.Module> = true;
const _ModuleColor: Equal<z.infer<typeof Z.ModuleColorSchema>, T.ModuleColor> = true;
const _ModuleCreate: Equal<z.infer<typeof Z.ModuleCreateSchema>, T.ModuleCreate> = true;
const _ModuleList: Equal<z.infer<typeof Z.ModuleListSchema>, T.ModuleList> = true;
const _ModuleUpdate: Equal<z.infer<typeof Z.ModuleUpdateSchema>, T.ModuleUpdate> = true;
const _PdfIngestDeckPayload: Equal<z.infer<typeof Z.PdfIngestDeckPayloadSchema>, T.PdfIngestDeckPayload> = true;
const _PdfIngestPayload: Equal<z.infer<typeof Z.PdfIngestPayloadSchema>, T.PdfIngestPayload> = true;
const _PdfIngestResult: Equal<z.infer<typeof Z.PdfIngestResultSchema>, T.PdfIngestResult> = true;
const _PdfIngestSheetPayload: Equal<z.infer<typeof Z.PdfIngestSheetPayloadSchema>, T.PdfIngestSheetPayload> = true;
const _Semester: Equal<z.infer<typeof Z.SemesterSchema>, T.Semester> = true;
const _SemesterCreate: Equal<z.infer<typeof Z.SemesterCreateSchema>, T.SemesterCreate> = true;
const _SemesterList: Equal<z.infer<typeof Z.SemesterListSchema>, T.SemesterList> = true;
const _SemesterUpdate: Equal<z.infer<typeof Z.SemesterUpdateSchema>, T.SemesterUpdate> = true;
const _Slide: Equal<z.infer<typeof Z.SlideSchema>, T.Slide> = true;
const _SlideDeck: Equal<z.infer<typeof Z.SlideDeckSchema>, T.SlideDeck> = true;
const _SlideDeckDetail: Equal<z.infer<typeof Z.SlideDeckDetailSchema>, T.SlideDeckDetail> = true;
const _SlideDeckList: Equal<z.infer<typeof Z.SlideDeckListSchema>, T.SlideDeckList> = true;
const _Task: Equal<z.infer<typeof Z.TaskSchema>, T.Task> = true;
const _TextBlock: Equal<z.infer<typeof Z.TextBlockSchema>, T.TextBlock> = true;
const _Timestamp: Equal<z.infer<typeof Z.TimestampSchema>, T.Timestamp> = true;
const _UploadResult: Equal<z.infer<typeof Z.UploadResultSchema>, T.UploadResult> = true;
const _Uuid: Equal<z.infer<typeof Z.UuidSchema>, T.Uuid> = true;
