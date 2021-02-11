import {StepEnum} from '../enums/step.enum';

import {StatusClusterEnums} from '../enums/status.cluster.Enums';

export class StatusCluster {
  step?: StepEnum;
  status?: StatusClusterEnums;
  message?: string;

}
