#!/bin/sh

echo "Syncing MongoDB"
mongodump -d salsadelphia -o /tmp/mongodump.salsadelphia &&
rsync -a /tmp/mongodump.salsadelphia boutell@boutell.com:/tmp/mongodump.salsadelphia/ &&
ssh boutell@boutell.com mongorestore --drop -d salsadelphia /tmp/mongodump.salsadelphia/salsadelphia &&
#echo "Syncing Files" &&
#rsync -a --delete boutell@boutell.com:/opt/stagecoach/apps/salsadelphia/uploads/ ./public/uploads &&
echo "Synced up to production"


