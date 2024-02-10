import m from 'mongoose';

const Schema = m.Schema;

const trainingProgressSchema = new mongoose.Schema({
    userId: { type: Schema.Types.ObjectId, ref: 'User' },
    modulesInProgress: [{
      moduleId: { type: Schema.Types.ObjectId, ref: 'trainingModule' },
      status: { type: Number, default: 0 }, // 0: Not Started, 1: In Progress, 2: Completed
      combinedWith: { type: Schema.Types.ObjectId, ref: 'trainingModule' }, // Tracks if combined with another module
    }],
    // Additional tracking fields as necessary
  });
  
export default m.model('TrainingProgress', trainingProgressSchema, 'trainingProgress');