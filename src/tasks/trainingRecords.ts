import { stringSimilarity } from 'string-similarity-js';
import { vatusaApi } from '../app.js';
import { TrainingSessionModel } from '../models/trainingSession.js';

interface IVatusaResponse {
	data: IVatusaTrainingRecords[];
	testing: boolean;
}

// Only required fields from data
interface IVatusaTrainingRecords {
	id: number;
	student_id: number;
	instructor_id: number;
	session_date: string;
	facility_id: string;
	position: string;
	duration: string; // HH:MM:SS
	movements: number | null;
	score: number;
	notes: string;
	location: number;
	ots_status: number;
	created_at: Date;
}

export async function syncVatusaTrainingRecords() {
	if (!process.env['VATUSA_API_KEY']) {
		console.log('Skipping VATUSA Training Records sync due to no VATUSA API KEY.');
	}

	try {
		const zauRecords = await TrainingSessionModel.find({}).exec();
		if (!zauRecords || zauRecords.length === 0) {
			console.log('No ZAU training sessions found, skipping sync.');
			return;
		}

		const zauSessions = zauRecords.filter((s) => !s.vatusaId || s.vatusaId === 0);

		const { data: vData } = await vatusaApi.get('/facility/zau/training/records');

		if (!vData) return;

		const vatusaData = (vData as IVatusaResponse).data.filter((z) => z.facility_id === 'ZAU');
		if (!vatusaData || vatusaData.length === 0) {
			console.log('No VATUSA training sessions found, skipping sync.');
			return;
		}

		let syncedCount = 0;
		let addedCount = 0;
		let updatedCount = 0;

		for (const zau of zauSessions) {
			const matches = vatusaData.filter(
				(v) =>
					v.instructor_id === zau.instructorCid &&
					v.student_id === zau.studentCid &&
					v.position === zau.position &&
					v.location === zau.location &&
					new Date(v.session_date + '+00:00').getTime() === zau.startTime.getTime() &&
					zau.studentNotes &&
					stringSimilarity(
						v.notes
							.replaceAll('<p>', '')
							.replaceAll('</p>', '')
							.replaceAll('\\n', '')
							.replaceAll('&amp;', '-')
							.replaceAll('&apos;', "'")
							.replaceAll('\n', '')
							.replaceAll('&gt;', '>')
							.replaceAll('&lt;', '<')
							.replaceAll('<br>', '')
							.trim(),
						zau.studentNotes.replaceAll('\n', '').trim(),
					) >= 0.9,
			);

			if (matches.length !== 1) {
				continue;
			}

			const match = matches[0]!;
			zau.vatusaId = match.id;
			zau.submitted = true;
			await zau.save();
			syncedCount++;
		}

		for (const record of vatusaData) {
			const conformedNote = record.notes
				.replaceAll('<p>', '')
				.replaceAll('</p>', '')
				.replaceAll('\\n', '')
				.replaceAll('&amp;', '-')
				.replaceAll('&apos;', "'")
				.replaceAll('&gt;', '>')
				.replaceAll('&lt;', '<')
				.replaceAll('<br>', '')
				.replaceAll('<li>', '- ')
				.replaceAll('</li>', '');

			const matched = zauRecords.find((z) => z.vatusaId === record.id);

			if (!matched) {
				await TrainingSessionModel.create({
					studentCid: record.student_id,
					instructorCid: record.instructor_id,
					milestoneCode: 'UNKNOWN',
					position: record.position,
					startTime: new Date(record.session_date + '+00:00'),
					endTime: new Date(
						new Date(record.session_date + '+00:00').getTime() +
							parseInt(record.duration.slice(0, 2)) * 3_600_000 +
							parseInt(record.duration.slice(3, 5)) * 60_000,
					),
					progress: record.score,
					duration: record.duration.slice(0, -3),
					movements: record.movements || 0,
					location: record.location,
					ots: record.ots_status,
					studentNotes: conformedNote,
					submitted: true,
					vatusaId: record.id,
				});
				addedCount++;
			} else {
				if (stringSimilarity(conformedNote, matched.studentNotes || '') < 0.9) {
					matched.studentNotes = conformedNote;
					matched.progress = record.score;
					matched.movements = record.movements || 0;
					matched.location = record.location;
					matched.position = record.position;
					matched.startTime = new Date(record.session_date + '+00:00');
					matched.endTime = new Date(
						new Date(record.session_date + '+00:00').getTime() +
							parseInt(record.duration.slice(0, 2)) * 3_600_000 +
							parseInt(record.duration.slice(3, 5)) * 60_000,
					);
					await matched.save();
					updatedCount++;
				}
			}
		}

		console.log(`Synced ${syncedCount} training records from VATUSA.`);
		console.log(`Added ${addedCount} new training records from VATUSA.`);
		console.log(`Updated ${updatedCount} training sessions with VATUSA's notes.`);
	} catch (err) {
		console.log('Error syncing VATUSA Training Records', err);
	}
}
