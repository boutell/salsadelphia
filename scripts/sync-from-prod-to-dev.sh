#!/bin/sh

echo "Syncing MongoDB"
ssh boutell@boutell.com mongodump -d salsadelphia -o /tmp/mongodump.salsadelphia &&
rsync -a boutell@boutell.com:/tmp/mongodump.salsadelphia/ /tmp/mongodump.salsadelphia &&
mongorestore --drop -d salsadelphia /tmp/mongodump.salsadelphia/salsadelphia &&
#echo "Syncing Files" &&
#rsync -a --delete boutell@boutell.com:/opt/stagecoach/apps/salsadelphia/uploads/ ./public/uploads &&
echo "Synced down from production"


