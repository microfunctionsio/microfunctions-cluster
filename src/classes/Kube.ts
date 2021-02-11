import moment = require('moment');

export class Kube {
  apiVersion: string;
  kind: string;
  metadata: any;

  getId() {
    return this.metadata.uid;
  }

  getResourceVersion() {
    return this.metadata.resourceVersion;
  }

  get name() {
    return this.metadata.name;
  }

  get ns() {
    // avoid "null" serialization via JSON.stringify when post data
    return this.metadata.namespace || undefined;
  }

  // todo: refactor with named arguments
  getAge(humanize = true, compact = true, fromNow = false) {
    if (fromNow) {
      return moment(this.metadata.creationTimestamp).fromNow();
    }
    const diff =
      new Date().getTime() -
      new Date(this.metadata.creationTimestamp).getTime();
    if (humanize) {
      // return formatDuration(this.metadata.creationTimestamp, compact);
    }
    return diff;
  }

  get finalizers(): string[] {
    return this.metadata.finalizers || [];
  }

  get labels(): string[] {
    return this.stringifyLabels(this.metadata.labels);
  }

  stringifyLabels(labels: { [name: string]: string }): string[] {
    if (!labels) {
      return [];
    }
    return Object.entries(labels).map(([name, value]) => `${name}=${value}`);
  }
}
