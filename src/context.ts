

/*/ ***** Importaciones ***** /*/
import type { Config                 } from './config.js';
import type { Db                     } from './db/index.js';
import type { NotificationDispatcher } from './notifications/dispatcher.js';
// ####################################################################################################


/*/ ***** Exportaciones ***** /*/
export interface AppContext {
	db        : Db;
	config    : Config;
	dispatcher: NotificationDispatcher;
}
// ####################################################################################################
