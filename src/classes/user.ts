import {TypeClient} from '../enums/typeClient';

export interface User {
  email: string;
  id: string;
  provider?: string;
  profileId?: string;
  profiles?: any[];
  namespaces?: any[];
  typeClient?: TypeClient;
}
