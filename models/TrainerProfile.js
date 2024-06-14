import m from 'mongoose';

const trainerProfileSchema = new m.Schema({
  trainerId: { type: m.Schema.Types.ObjectId, ref: 'User' },
  assignableModules: [{
      moduleId: { type: m.Schema.Types.ObjectId, ref: 'TrainingModule' },
      canTeach: { type: Boolean, default: false },
  }],
  canConductEVAL: { type: Boolean, default: false },
  // Additional fields as needed
}, {
  timestamps: true,
  collection: 'trainerProfile',
});

export default m.model('TrainerProfile', trainerProfileSchema, 'trainerProfile');