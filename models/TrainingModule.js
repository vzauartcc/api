import m from 'mongoose';

const Schema = m.Schema;

const trainingModuleSchema = new Schema({
    name: String,
    description: String,
    courses: [{
      courseName: String,
      description: String,
      type: String,
      facility: String
    }],
    isExtension: { type: Boolean, default: false },
    prerequisites: [{ type: Schema.Types.ObjectId, ref: 'trainingModule' }], // References to prerequisite modules
    extensionModule: { type: Schema.Types.ObjectId, ref: 'trainingModule', default: null }, // Link to a module if this is an extension
});
  
export default m.model('TrainingModule', trainingModuleSchema, 'trainingModule');